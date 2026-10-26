"""Image upload boundaries: actual format, full decode, pixel limits and serving."""
from io import BytesIO

from PIL import Image
import pytest

from app.core.config import settings
from app.services import diagnosis_service


@pytest.fixture(autouse=True)
def fixed_predictions(monkeypatch):
    # These tests exercise file/API behavior; CNN accuracy is unrelated.
    monkeypatch.setattr(diagnosis_service, "predict_all", lambda _: [(2, .55), (3, .45)])
    monkeypatch.setattr(diagnosis_service, "predict_pair", lambda _: None)


def encoded_image(fmt):
    buf = BytesIO()
    Image.new("RGB", (64, 64), (40, 130, 20)).save(buf, fmt)
    return buf.getvalue()


def upload(client, data, name="photo.jpg", endpoint="/api/v1/diagnose"):
    return client.post(endpoint, files={"file": (name, data, "image/jpeg")})


@pytest.mark.parametrize("fmt,suffix,mime", [("JPEG", ".jpg", "image/jpeg"), ("PNG", ".png", "image/png")])
@pytest.mark.parametrize("refine", [False, True])
def test_actual_image_format_controls_storage_and_serving(client, fmt, suffix, mime, refine):
    endpoint = "/api/v1/diagnose"
    field = "image_url"
    if refine:
        first = upload(client, encoded_image("JPEG")).json()
        endpoint += f"/{first['id']}/refine"
        field = "refined_image_url"
    content = encoded_image(fmt) + b"\n<html><body>inert review marker</body></html>"
    response = upload(client, content, "photo.html", endpoint)
    assert response.status_code == 200
    image_url = response.json()[field]
    assert image_url.endswith(suffix)
    served = client.get(image_url)
    assert served.headers["content-type"] == mime
    assert served.headers["x-content-type-options"] == "nosniff"
    # Preserve model input bytes: no re-encoding or implicit rotation. Data
    # appended after the image is dropped with the metadata.
    assert served.content == encoded_image(fmt)


def test_legacy_html_upload_is_not_served_as_document(client):
    path = settings.upload_dir / "legacy-photo.html"
    path.write_bytes(encoded_image("JPEG") + b"<html>inert</html>")
    try:
        assert client.get("/uploads/legacy-photo.html").status_code == 404
    finally:
        path.unlink()


def test_legacy_jpeg_remains_available(client):
    path = settings.upload_dir / "legacy-photo.JPEG"
    path.write_bytes(encoded_image("JPEG"))
    try:
        response = client.get("/uploads/legacy-photo.JPEG")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        assert response.headers.get("x-content-type-options") == "nosniff"
    finally:
        path.unlink()


@pytest.mark.parametrize("refine", [False, True])
def test_truncated_pixel_data_rejected_before_saving(client, refine):
    endpoint = "/api/v1/diagnose"
    if refine:
        first = upload(client, encoded_image("JPEG")).json()
        endpoint += f"/{first['id']}/refine"
    before_files = set(settings.upload_dir.iterdir())
    before_count = client.get("/api/v1/history").json()["total"]
    response = upload(client, encoded_image("JPEG")[:-20], endpoint=endpoint)
    assert response.status_code == 400
    assert set(settings.upload_dir.iterdir()) == before_files
    assert client.get("/api/v1/history").json()["total"] == before_count
    if refine:
        detail = client.get(f"/api/v1/history/{first['id']}").json()
        assert detail["refined_image_url"] is None


def test_image_pixel_budget_rejected_before_saving(client, monkeypatch):
    monkeypatch.setitem(settings.__dict__, "max_image_pixels", 4095)
    before = set(settings.upload_dir.iterdir())
    response = upload(client, encoded_image("PNG"))
    assert response.status_code == 413
    assert set(settings.upload_dir.iterdir()) == before


def test_pillow_decompression_bomb_is_client_error(client, monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    response = upload(client, encoded_image("PNG"))
    assert response.status_code == 413


def test_non_supported_image_format_rejected(client):
    response = upload(client, encoded_image("GIF"), "photo.gif")
    assert response.status_code == 400


@pytest.mark.parametrize("refine", [False, True])
def test_png_checksum_error_rejected_before_saving(client, refine):
    endpoint = "/api/v1/diagnose"
    if refine:
        first = upload(client, encoded_image("JPEG")).json()
        endpoint += f"/{first['id']}/refine"
    content = bytearray(encoded_image("PNG"))
    chunk_type = content.index(b"IDAT")
    chunk_length = int.from_bytes(content[chunk_type - 4:chunk_type], "big")
    content[chunk_type + 4 + chunk_length] ^= 1  # Corrupt IDAT checksum only.
    before = set(settings.upload_dir.iterdir())
    response = upload(client, bytes(content), "photo.png", endpoint)
    assert response.status_code == 400
    assert set(settings.upload_dir.iterdir()) == before


@pytest.mark.parametrize("fmt", ["GIF"])
@pytest.mark.parametrize("refine", [False, True])
def test_disallowed_image_parser_is_never_called(client, monkeypatch, refine, fmt):
    from PIL import GifImagePlugin, WebPImagePlugin

    endpoint = "/api/v1/diagnose"
    if refine:
        first = upload(client, encoded_image("JPEG")).json()
        endpoint += f"/{first['id']}/refine"
    content = encoded_image(fmt)
    before = set(settings.upload_dir.iterdir())

    def forbidden_parser(_self):
        raise AssertionError("Disallowed image parser was invoked")

    parser = GifImagePlugin.GifImageFile if fmt == "GIF" else WebPImagePlugin.WebPImageFile
    monkeypatch.setattr(parser, "_open", forbidden_parser)
    response = upload(client, content, "disguised.jpg", endpoint)
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_IMAGE"
    assert response.json()["detail"]
    assert set(settings.upload_dir.iterdir()) == before


@pytest.mark.parametrize("content", [b"not an image", b"\xff\xd8\xff\xe0", b"\x89PNG\r\n\x1a\n"])
@pytest.mark.parametrize("refine", [False, True])
def test_unidentifiable_image_keeps_invalid_code_and_format_guidance(client, content, refine):
    endpoint = "/api/v1/diagnose"
    if refine:
        first = upload(client, encoded_image("JPEG")).json()
        endpoint += f"/{first['id']}/refine"
    before_files = set(settings.upload_dir.iterdir())
    before_count = client.get("/api/v1/history").json()["total"]
    response = upload(client, content, endpoint=endpoint)
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_IMAGE"
    assert response.json()["detail"]
    assert set(settings.upload_dir.iterdir()) == before_files
    assert client.get("/api/v1/history").json()["total"] == before_count
