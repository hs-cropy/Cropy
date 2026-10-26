"""Stored photos keep their pixels and orientation but no GPS/camera metadata."""
from io import BytesIO

from PIL import Image, ImageCms, PngImagePlugin
import pytest

from app.core.image_processing import prepare_image
from app.services import diagnosis_service as service

PRIVATE = (b"private-camera-owner", b"private-location", b"37/1", b"ftypmp42")


def photo():
    image = Image.new("RGB", (64, 48), (0, 200, 0))
    image.paste((220, 0, 0), (0, 0, 32, 48))
    return image


def private_exif(orientation=6):
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010F] = "private-camera-owner"  # Make
    exif[0x8825] = {1: "N", 2: (37.0, 30.0, 0.0), 3: "E", 4: (127.0, 0.0, 0.0)}  # GPS IFD
    return exif


def private_jpeg(**options):
    buf = BytesIO()
    photo().save(buf, "JPEG", exif=private_exif(), comment=b"private-location", **options)
    data = buf.getvalue()
    xmp = b"http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>private-location</x:xmpmeta>"
    iptc = b"Photoshop 3.0\0private-location"
    # Insert XMP (APP1) and IPTC (APP13) after SOI; append a motion-photo style trailer.
    segments = b"".join(b"\xff" + bytes([m]) + (len(p) + 2).to_bytes(2, "big") + p for m, p in ((0xE1, xmp), (0xED, iptc)))
    return data[:2] + segments + data[2:] + b"....ftypmp42 private-location video"


def pixels(content):
    with Image.open(BytesIO(content)) as image:
        return image.mode, image.size, image.tobytes()


def assert_private_free(content):
    for marker in PRIVATE:
        assert marker not in content


@pytest.mark.parametrize("progressive", [False, True])
def test_jpeg_metadata_removed_without_reencoding(progressive):
    original = private_jpeg(progressive=progressive)
    stored, extension = prepare_image(original)
    assert extension == ".jpg"
    assert_private_free(stored)
    assert pixels(stored) == pixels(original)  # model input is byte-identical
    with Image.open(BytesIO(stored)) as image:
        assert dict(image.getexif()) == {0x0112: 6}  # browsers still rotate it
        assert "comment" not in image.info


def test_jpeg_without_orientation_gets_no_exif():
    buf = BytesIO()
    photo().save(buf, "JPEG", comment=b"private-location")
    stored, _ = prepare_image(buf.getvalue())
    assert_private_free(stored)
    with Image.open(BytesIO(stored)) as image:
        assert not image.getexif()


def test_jpeg_icc_profile_is_kept():
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    buf = BytesIO()
    photo().save(buf, "JPEG", icc_profile=profile, exif=private_exif())
    stored, _ = prepare_image(buf.getvalue())
    assert_private_free(stored)
    with Image.open(BytesIO(stored)) as image:
        assert image.info.get("icc_profile") == profile


def test_png_text_and_exif_chunks_removed():
    image = Image.new("RGBA", (32, 24), (0, 0, 0, 0))
    image.putpixel((10, 10), (255, 0, 0, 255))
    info = PngImagePlugin.PngInfo()
    info.add_text("Author", "private-camera-owner")
    info.add_itxt("XML:com.adobe.xmp", "private-location")
    buf = BytesIO()
    image.save(buf, "PNG", pnginfo=info, exif=private_exif())
    original = buf.getvalue() + b"trailing private-location"
    stored, extension = prepare_image(original)
    assert extension == ".png"
    assert_private_free(stored)
    assert pixels(stored) == pixels(original)
    for chunk in (b"tEXt", b"iTXt", b"eXIf"):
        assert chunk not in stored


@pytest.mark.parametrize("refine", [False, True])
def test_uploaded_photo_is_served_without_metadata(client, sample_image, monkeypatch, refine):
    monkeypatch.setattr(service, "predict_all", lambda _: [(0, .9), (1, .1)])
    monkeypatch.setattr(service, "predict_pair", lambda _: None)
    endpoint, field = "/api/v1/diagnose", "image_url"
    if refine:
        first = client.post(endpoint, files={"file": ("x.jpg", sample_image, "image/jpeg")}).json()
        endpoint += f"/{first['id']}/refine"
        field = "refined_image_url"
    original = private_jpeg()
    response = client.post(endpoint, files={"file": ("phone.jpg", original, "image/jpeg")})
    assert response.status_code == 200, response.text
    served = client.get(response.json()[field]).content
    assert_private_free(served)
    assert pixels(served) == pixels(original)
