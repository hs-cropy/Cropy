import json
import os
from pathlib import Path
import subprocess

import pytest

from scripts import export_browser_model as exporter


@pytest.mark.skipif(os.name != "nt", reason="NTFS permission inheritance regression")
def test_exported_model_inherits_public_directory_read_permissions(tmp_path, monkeypatch):
    torch = pytest.importorskip("torch")
    pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")
    from app.services import ml_service

    # A real, small ONNX export avoids depending on a private training checkpoint.
    model = torch.nn.Sequential(torch.nn.Flatten(), torch.nn.Linear(3 * 8 * 8, 9))
    monkeypatch.setattr(ml_service, "_read_checkpoint",
                        lambda *_: ((model, tuple(range(9)), "cpu", 8), "checkpoint-test"))
    target = tmp_path / "public"
    target.mkdir()
    subprocess.run(["icacls.exe", str(target), "/grant", "*S-1-5-32-545:(OI)(CI)(RX)"],
                   check=True, capture_output=True)

    exporter.export(Path("unused.pth"), target)

    manifest = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
    published = target / Path(manifest["model_url"]).name
    script = ("$acl = Get-Acl -LiteralPath $env:CROPY_ACL_TEST_PATH; "
              "@($acl.Access | Where-Object { $_.IsInherited -and "
              "$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value "
              "-eq 'S-1-5-32-545' }).Count")
    result = subprocess.run(["powershell.exe", "-NoProfile", "-Command", script],
                            env={**os.environ, "CROPY_ACL_TEST_PATH": str(published)},
                            check=True, capture_output=True, text=True)
    assert int(result.stdout.strip()) > 0, "Published model lost inherited Users read access"
    assert published.stat().st_size == manifest["model_bytes"]

@pytest.mark.parametrize("failure", ["copy", "replace"])
def test_failed_model_publication_preserves_previous_bundle(tmp_path, monkeypatch, failure):
    source = tmp_path / "validated.onnx"
    source.write_bytes(b"new validated model")
    target = tmp_path / "public"
    target.mkdir()
    published = target / "cnn-existing.onnx"
    published.write_bytes(b"previous model")
    manifest = target / "manifest.json"
    manifest.write_bytes(b"previous manifest")

    def fail(*args):
        raise OSError("publication interrupted")

    if failure == "copy":
        monkeypatch.setattr(exporter.shutil, "copyfileobj", fail)
    else:
        monkeypatch.setattr(exporter.os, "replace", fail)
    with pytest.raises(OSError, match="publication interrupted"):
        exporter._publish_model(source, published)

    assert published.read_bytes() == b"previous model"
    assert manifest.read_bytes() == b"previous manifest"
    assert source.read_bytes() == b"new validated model"
    assert sorted(path.name for path in target.iterdir()) == ["cnn-existing.onnx", "manifest.json"]


def test_model_publication_copies_bytes_without_changing_source(tmp_path):
    source = tmp_path / "validated.onnx"
    source.write_bytes(b"validated model bytes")
    target = tmp_path / "public"
    target.mkdir()
    published = target / "cnn-model.onnx"

    exporter._publish_model(source, published)

    assert published.read_bytes() == b"validated model bytes"
    assert source.read_bytes() == b"validated model bytes"
    assert list(target.iterdir()) == [published]
