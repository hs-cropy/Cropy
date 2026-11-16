"""Export current validated CNN; verify identical-tensor parity before publishing.

--function-bundle <kind>=<dir> 를 주면 CNN 대신 기능 선택 모델 묶음을 등록한다 (#166).
파일마다 SHA-256을 계산해 function/<kind>/<version16>/ 에 복사하고 function-models.json 을 교체한다.
"""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path, PurePosixPath
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


def file_sha256(path):
    # 1.34GB 묶음도 있으므로 파일 전체를 메모리에 읽지 않는다
    digest = hashlib.sha256()
    with path.open("rb") as incoming:
        for block in iter(lambda: incoming.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# 기기 종류별 묶음. mobile_clf: 휴대폰(iPhone·안드로이드) 소형 분류기, web_qwen: PC WebGPU Qwen q4f16,
# stt: 오프라인 화면의 기기 안 받아 적기(SenseVoice int8). stt 폴더는 stt/make_browser_bundle.py 가 만든다
MOBILE_CLF_FILES = ["model_int8.onnx", "tokenizer.json", "tokenizer_config.json", "labels.json"]
WEB_QWEN_PREFIX_FILES = ["prefix_q4f16.json", "prefix_q4f16.bin"]
STT_FILES = ["model.int8.onnx", "tokens.txt", "sensevoice.json", "terms.txt"]
FUNCTION_KINDS = ("mobile_clf", "web_qwen", "stt")


def _safe_name(name):
    # 묶음 폴더 밖을 가리키는 이름은 복사 전에 막는다. 이름은 URL 경로이기도 하므로 / 로 나눈 상대 경로만 받는다.
    # Windows 에서는 "/x"·"C:x" 가 is_absolute() 를 통과하므로 루트·드라이브(:)·역슬래시를 따로 막는다
    if not isinstance(name, str) or not name or "\\" in name or ":" in name:
        raise ValueError(f"묶음 밖을 가리키는 파일 이름: {name}")
    parts = PurePosixPath(name).parts
    if PurePosixPath(name).is_absolute() or not parts or any(part in (".", "..") for part in name.split("/")):
        raise ValueError(f"묶음 밖을 가리키는 파일 이름: {name}")
    return name


def _inside(root, name):
    path = root / name
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"묶음 밖을 가리키는 파일 이름: {name}")
    return path


# 묶음 파일 하나의 최대 크기. shard_bundle.py 기본값(256MB)으로 나누면 넘지 않는다
MAX_BUNDLE_FILE_BYTES = 512 * 2**20


def function_bundle_files(kind, source):
    if kind == "mobile_clf":
        names = list(MOBILE_CLF_FILES)
    elif kind == "stt":
        names = list(STT_FILES)
    elif kind == "web_qwen":
        # files.json 은 ml/qwen/onnx_web 이 만드는 [[이름, 바이트], ...] 목록이다
        listed = json.loads((source / "files.json").read_text(encoding="utf-8"))
        if not isinstance(listed, list) or not all(isinstance(item, list) and len(item) == 2 and isinstance(item[1], int) for item in listed):
            raise ValueError("files.json 은 [[이름, 바이트], ...] 형식이어야 합니다")
        for name, size in listed:
            _safe_name(name)
            if not _inside(source, name).is_file() or (source / name).stat().st_size != size:
                raise ValueError(f"files.json 과 크기가 다른 파일: {name}")
        names = [name for name, _ in listed]
        names += [name for name in WEB_QWEN_PREFIX_FILES if name not in names]
        if len(set(names)) != len(names):
            raise ValueError("files.json 에 같은 파일이 두 번 있습니다")
    else:
        raise ValueError(f"알 수 없는 묶음 종류: {kind} (가능: {', '.join(FUNCTION_KINDS)})")
    for name in names:
        _safe_name(name)
        if not _inside(source, name).is_file():
            raise ValueError(f"{kind} 묶음에 필요한 파일이 없습니다: {name}")
        # 브라우저는 파일 하나를 통째로 메모리에 받아 SHA-256을 확인한 뒤 Cache Storage에 넣는다.
        # Chrome은 1GB가 넘는 응답을 캐시에 넣지 못하므로(2026-11-15 1.09GB 디코더에서 확인) 큰 파일은 나눠야 한다
        if (source / name).stat().st_size > MAX_BUNDLE_FILE_BYTES:
            raise ValueError(f"{name} 이 {MAX_BUNDLE_FILE_BYTES // 2**20}MB 를 넘습니다. "
                             "ml/qwen/onnx_web/shard_bundle.py 로 나눈 뒤 files.json 을 다시 만드세요")
    return names


def publish_function_bundle(kind, source, target):
    names = function_bundle_files(kind, source)
    files = [{"name": name, "bytes": (source / name).stat().st_size, "sha256": file_sha256(source / name)} for name in names]
    version = bundle_version(files)
    base = target / "function" / kind / version[:16]
    for entry in files:
        destination = base / entry["name"]
        base.mkdir(parents=True, exist_ok=True)
        _inside(base, entry["name"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        # 같은 version 폴더는 내용이 같으므로 이미 맞게 있으면 다시 복사하지 않는다
        if destination.is_file() and destination.stat().st_size == entry["bytes"] and file_sha256(destination) == entry["sha256"]:
            continue
        _publish_model(source / entry["name"], destination)
    bundle = {"version": version, "base_url": f"/offline-assets/function/{kind}/{version[:16]}",
              "total_bytes": sum(entry["bytes"] for entry in files), "files": files}
    # CNN manifest.json 과 따로 둔다: 합치면 CNN 묶음 version 이 바뀌어 CNN만 받은 기기도 업데이트를 묻는다
    path = target / "function-models.json"
    models = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    models[kind] = bundle
    temporary = target / "function-models.next.json"
    temporary.write_text(json.dumps(models, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    return bundle


def offline_pesticides():
    """모델 클래스 번호 → 서버 진단 응답과 같은 등록 농약 목록 (pesticide_service.pesticide_infos 를 그대로 쓴다).
    seed_database 를 메모리 SQLite 에 돌리므로 검증 카탈로그(pesticide_catalog.json)가 있으면 PSIS verified, 없으면
    legacy_unverified 목록이 들어간다. 오프라인 음성의 농약 질문(get_pesticide_information)이 이 값을 읽는다"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.models.entities import Base, Disease
    from app.services.pesticide_service import pesticide_infos
    from app.services.seed import seed_database
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        seed_database(db)
        db.commit()
        result = {d.model_class_id: [p.model_dump(mode="json") for p in pesticide_infos(db, d.id)] for d in db.query(Disease).all()}
    finally:
        db.close(); engine.dispose()
    rows = [p for items in result.values() for p in items]
    verified = rows and all(p["verification_status"] == "verified" for p in rows)
    return result, ("psis_verified" if verified else "legacy_unverified" if rows else "not_bundled")


def refresh_pesticides(target):
    """이미 내보낸 manifest.json 의 등록 농약만 바꾼다 (CNN 은 그대로). 카탈로그를 갱신한 뒤 서버에서 돌린다"""
    path = target / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    pesticides, status = offline_pesticides()
    for d in manifest["diseases"]:
        d["pesticides"] = pesticides.get(d["model_class_id"], [])
    manifest["pesticide_status"] = status
    manifest.pop("version", None)
    manifest["version"] = bundle_version(manifest)
    encoded = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (target / f"manifest-{manifest['version'][:16]}.json").write_text(encoded, encoding="utf-8")
    temporary = target / "manifest.next.json"
    temporary.write_text(encoded, encoding="utf-8")
    os.replace(temporary, path)
    print(json.dumps({"version": manifest["version"], "pesticide_status": status,
                      "pesticides": sum(len(d["pesticides"]) for d in manifest["diseases"])}))


def export(checkpoint, target):
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from app.services.ml_service import MODEL_CLASS_IDS, OPTIONAL_CLASS_IDS, _read_checkpoint, IMAGENET_MEAN, IMAGENET_STD
    from app.services.decision import POLICY_VERSION
    from app.core.config import settings
    from app.services.recapture import CONFUSION_PAIRS, DEFAULT_MARGIN, FUSE_WEIGHT_SECOND

    loaded, digest = _read_checkpoint(checkpoint, set(MODEL_CLASS_IDS), OPTIONAL_CLASS_IDS)
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
        file_hash = file_sha256(model_path)
        del session  # ORT memory mapping holds the file open on Windows.
        import gc
        gc.collect()
        name = f"cnn-{file_hash[:16]}.onnx"
        _publish_model(model_path, target / name)
    seed = Path(__file__).resolve().parents[1] / "app/data/seed/diseases.json"
    diseases = [d for d in json.loads(seed.read_text(encoding="utf-8")) if d["model_class_id"] in class_ids]
    pesticides, pesticide_status = offline_pesticides()
    for d in diseases:
        d["pesticides"] = pesticides.get(d["model_class_id"], [])
    manifest = {
        "model_version": digest, "format": "onnx", "model_url": f"/offline-assets/{name}",
        "model_bytes": (target / name).stat().st_size, "sha256": file_hash, "class_ids": list(class_ids),
        "input_size": size, "mean": list(IMAGENET_MEAN), "std": list(IMAGENET_STD),
        "preprocessing_version": f"browser-canvas-{size}-imagenet-v1",
        "server_preprocessing_version": f"resize-{size}-imagenet-v1",
        "content_source": "manual_seed", "pesticide_status": pesticide_status,
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
    parser.add_argument("--function-bundle", action="append", default=[], metavar="KIND=DIR",
                        help="기능 선택·받아 적기 묶음 등록 (mobile_clf, web_qwen, stt). 주면 CNN은 내보내지 않는다")
    parser.add_argument("--refresh-pesticides", action="store_true",
                        help="CNN 은 그대로 두고 manifest.json 의 등록 농약만 카탈로그 기준으로 다시 쓴다")
    args = parser.parse_args()
    if args.refresh_pesticides:
        refresh_pesticides(args.output)
    elif args.function_bundle:
        for spec in args.function_bundle:
            kind, _, source = spec.partition("=")
            if not source:
                parser.error("--function-bundle 은 KIND=DIR 형식입니다")
            entry = publish_function_bundle(kind, Path(source), args.output)
            print(json.dumps({"kind": kind, "version": entry["version"], "bytes": entry["total_bytes"], "files": len(entry["files"])}))
    else:
        export(args.checkpoint, args.output)
