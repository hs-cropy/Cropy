"""Export current validated CNN; verify identical-tensor parity before publishing."""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
import sys
import tempfile
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def bundle_version(manifest):
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def _publish_model(source, destination):
    # Create in the public directory: moving out of TemporaryDirectory retains
    # its restrictive NTFS ACL, whereas a new file inherits public read access.
    staging = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.next")
    output = staging.open("xb")
    try:
        with output, source.open("rb") as incoming:
            shutil.copyfileobj(incoming, output)
        os.replace(staging, destination)
    finally:
        staging.unlink(missing_ok=True)


def export(checkpoint, target):
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from app.services.ml_service import MODEL_CLASS_IDS, OTHER_CLASS_ID, _read_checkpoint, IMAGENET_MEAN, IMAGENET_STD
    from app.services.decision import POLICY_VERSION
    from app.core.config import settings
    from app.services.recapture import CONFUSION_PAIRS, DEFAULT_MARGIN, FUSE_WEIGHT_SECOND

    loaded, digest = _read_checkpoint(checkpoint, set(MODEL_CLASS_IDS), frozenset({OTHER_CLASS_ID}))
    model, class_ids, device, size = loaded
    model = model.cpu().eval()
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target) as temporary:
        model_path = Path(temporary) / "cnn.onnx"
        torch.manual_seed(17)
        sample = torch.randn(1, 3, size, size)
        torch.onnx.export(model, sample, str(model_path), input_names=["image"], output_names=["logits"],
                          opset_version=17, dynamo=False, external_data=False)
        onnx.checker.check_model(str(model_path))
        session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        max_error = 0.0
        for _ in range(3):
            sample = torch.randn(1, 3, size, size)
            with torch.no_grad():
                expected = model(sample).numpy()
            actual = session.run(None, {"image": sample.numpy()})[0]
            np.testing.assert_allclose(actual, expected, atol=1e-4, rtol=1e-4)
            max_error = max(max_error, float(np.max(np.abs(actual - expected))))
        file_hash = hashlib.sha256(model_path.read_bytes()).hexdigest()
        del session  # ORT memory mapping holds the file open on Windows.
        import gc
        gc.collect()
        name = f"cnn-{file_hash[:16]}.onnx"
        _publish_model(model_path, target / name)
    seed = Path(__file__).resolve().parents[1] / "app/data/seed/diseases.json"
    diseases = [d for d in json.loads(seed.read_text(encoding="utf-8")) if d["model_class_id"] in class_ids]
    for d in diseases:
        d["pesticides"] = []
    manifest = {
        "model_version": digest, "format": "onnx", "model_url": f"/offline-assets/{name}",
        "model_bytes": (target / name).stat().st_size, "sha256": file_hash, "class_ids": list(class_ids),
        "input_size": size, "mean": list(IMAGENET_MEAN), "std": list(IMAGENET_STD),
        "preprocessing_version": f"browser-canvas-{size}-imagenet-v1",
        "server_preprocessing_version": f"resize-{size}-imagenet-v1",
        "content_source": "manual_seed", "pesticide_status": "not_bundled",
        "diseases": diseases, "policy": {"version": POLICY_VERSION, "low_confidence_threshold": settings.low_confidence_threshold,
          "confusion_margin": DEFAULT_MARGIN, "second_photo_weight": FUSE_WEIGHT_SECOND,
          "pairs": [{"ids": sorted(ids), **entry} for ids, entry in CONFUSION_PAIRS.items()]},
        "validation": {"identical_tensor_max_logit_error": max_error, "cases": 3,
          "browser_preprocessing_parity": "requires_real_image_validation", "mobile_hardware": "not_measured"},
    }
    manifest["version"] = bundle_version(manifest)
    # Manifest switch is atomic; a failed export keeps the previous model usable.
    archive = target / f"manifest-{manifest['version'][:16]}.json"
    encoded = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    if archive.exists() and json.loads(archive.read_text(encoding="utf-8")) != manifest:
        raise RuntimeError("Bundle archive collision; existing metadata is preserved")
    archive.write_text(encoded, encoding="utf-8")
    temporary = target / "manifest.next.json"
    temporary.write_text(encoded, encoding="utf-8")
    os.replace(temporary, target / "manifest.json")
    print(json.dumps({"path": str(target / name), "bytes": manifest["model_bytes"], "validation": manifest["validation"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=Path("../ml/checkpoints/best_model.pth"))
    parser.add_argument("--output", type=Path, default=Path("../frontend/public/offline-assets"))
    args = parser.parse_args()
    export(args.checkpoint, args.output)
