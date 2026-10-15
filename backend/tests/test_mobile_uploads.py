"""Mobile image decoders must produce usable, bounded images before inference."""
from io import BytesIO

import pytest
from PIL import Image, TiffImagePlugin
from pillow_heif import register_heif_opener

from app.core.config import settings
from app.services import diagnosis_service

register_heif_opener()


def dng_image():
    # A real, uncompressed Bayer DNG: exercise LibRaw rather than mock decoding.
    image = Image.new("I;16", (64, 48), 16000)
    tags = TiffImagePlugin.ImageFileDirectory_v2()
    for key, value in {
        256: 64, 257: 48, 258: 16, 259: 1, 262: 32803,
        271: "Cropy", 272: "Test DNG", 33421: (2, 2), 33422: bytes([0, 1, 1, 2]),
        50706: bytes([1, 4, 0, 0]), 50707: bytes([1, 1, 0, 0]),
        50708: "Cropy Test DNG", 50717: 65535,
        50721: tuple(TiffImagePlugin.IFDRational(v) for v in (1, 0, 0, 0, 1, 0, 0, 0, 1)),
        50728: tuple(TiffImagePlugin.IFDRational(1) for _ in range(3)), 50778: 21,
    }.items():
        tags[key] = value
    buf = BytesIO()
    image.save(buf, "TIFF", tiffinfo=tags)
    return buf.getvalue()


def photo(fmt, size=(64, 48)):
    if fmt == "DNG":
        return dng_image()
    buf = BytesIO()
    Image.new("RGB", size, (40, 130, 20)).save(buf, fmt)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def predictions(monkeypatch):
    monkeypatch.setattr(diagnosis_service, "predict_all", lambda _: [(2, .55), (3, .45)])
    monkeypatch.setattr(diagnosis_service, "predict_pair", lambda _: None)


@pytest.mark.parametrize("fmt,mime,suffix", [
    ("HEIF", "image/heic", "HEIC"), ("HEIF", "application/octet-stream", "heif"),
    ("DNG", "image/x-adobe-dng", "DNG"), ("DNG", "application/octet-stream", "dng"),
    ("WEBP", "image/webp", "webp"), ("AVIF", "image/avif", "avif"),
])
@pytest.mark.parametrize("refine", [False, True])
def test_mobile_photo_saved_and_served_as_jpeg(client, fmt, mime, suffix, refine):
    endpoint, field = "/api/v1/diagnose", "image_url"
    if refine:
        first = client.post(endpoint, files={"file": ("first.jpg", photo("JPEG"), "image/jpeg")}).json()
        endpoint += f"/{first['id']}/refine"
        field = "refined_image_url"
    response = client.post(endpoint, files={"file": (f"phone.{suffix}", photo(fmt), mime)})
    assert response.status_code == 200, response.text
    url = response.json()[field]
    assert url.endswith(".jpg")
    served = client.get(url)
    assert served.headers["content-type"] == "image/jpeg"
    with Image.open(BytesIO(served.content)) as image:
        image.load()
        assert image.format == "JPEG"
        assert image.size == (64, 48)


@pytest.mark.parametrize("mime", ["", "application/octet-stream"])
def test_missing_mobile_mime_still_checks_actual_bytes(client, mime):
    response = client.post("/api/v1/diagnose", files={"file": ("phone.jpg", photo("JPEG"), mime)})
    assert response.status_code == 200
    before = set(settings.upload_dir.iterdir())
    response = client.post("/api/v1/diagnose", files={"file": ("phone.heic", b"<svg>not a photo</svg>", mime)})
    assert response.status_code == 400
    assert set(settings.upload_dir.iterdir()) == before


@pytest.mark.parametrize("fmt", ["HEIF", "DNG", "AVIF"])
def test_new_formats_obey_pixel_limit(client, monkeypatch, fmt):
    monkeypatch.setattr(settings, "max_image_pixels", 1000)
    response = client.post("/api/v1/diagnose", files={"file": ("phone." + fmt.lower(), photo(fmt), "application/octet-stream")})
    assert response.status_code == 413


def test_high_resolution_photo_is_resized_before_storage(client, monkeypatch):
    monkeypatch.setattr(settings, "max_image_pixels", 60_000_000)
    response = client.post("/api/v1/diagnose", files={"file": ("48mp.jpg", photo("JPEG", (8000, 6000)), "image/jpeg")})
    assert response.status_code == 200, response.text
    with Image.open(BytesIO(client.get(response.json()["image_url"]).content)) as image:
        assert image.size == (4096, 3072)


def test_capabilities_advertises_mobile_formats(client):
    formats = client.get("/api/v1/capabilities").json()["upload"]["formats"]
    assert {"JPEG", "PNG", "HEIF", "HEIC", "DNG", "WEBP", "AVIF"} <= set(formats)


@pytest.mark.parametrize("damage", ["truncated_tile", "oversized_tile"])
def test_corrupt_heif_decoder_errors_are_client_errors(client, damage):
    content = bytearray(photo("HEIF"))
    if damage == "truncated_tile":
        content[96] = 122
    else:
        content[content.find(b"ispe") + 8] = 181
    before = set(settings.upload_dir.iterdir())
    response = client.post("/api/v1/diagnose", files={"file": ("broken.heic", bytes(content), "image/heic")})
    assert response.status_code in (400, 413)
    assert set(settings.upload_dir.iterdir()) == before


def test_heif_primary_photo_and_orientation_are_preserved(client):
    buf = BytesIO()
    preview = Image.new("RGB", (16, 16), (230, 10, 10))
    main = Image.new("RGB", (64, 48), (10, 200, 20))
    exif = Image.Exif()
    exif[274] = 6
    main.info["exif"] = exif.tobytes()
    preview.save(buf, "HEIF", save_all=True, append_images=[main], primary_index=1)
    response = client.post("/api/v1/diagnose", files={"file": ("portrait.heic", buf.getvalue(), "image/heic")})
    assert response.status_code == 200
    with Image.open(BytesIO(client.get(response.json()["image_url"]).content)) as image:
        assert image.size == (48, 64)
        r, g, b = image.getpixel((20, 20))
        assert g > 150 and r < 60 and b < 60
        assert image.getexif().get(274, 1) == 1
