"""기능 선택 모델 자산 검사 (#164).

받은 모델 폴더가 `model_assets.json`에 적힌 파일·크기·SHA-256과 같은지, 그리고 계약 파일
(`cropy_prompt.json`, `labels.json`)의 함수 순서와 인자가 학습 때 계약(`spec_v2.FUNCTIONS`)과
같은지 확인한다. 기능 번호(<hs_N>)가 어긋나면 답변이 엉뚱한 기능으로 가므로 배포 전에 돌린다.

    python ml/qwen/check_assets.py server C:/cropy/eval/models/merged_hf
    python ml/qwen/check_assets.py mobile_clf C:/cropy/eval/clf8
    python ml/qwen/check_assets.py web_qwen <bundle 폴더> --write   # sha256이 비어 있는 항목을 채운다

종료 코드: 0 통과, 1 실패.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import spec_v2  # noqa: E402

MANIFEST = HERE / "model_assets.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 22), b""):
            digest.update(block)
    return digest.hexdigest()


def spec_signature() -> list[tuple[str, list[tuple[str, int]]]]:
    """학습 계약: 함수 이름 순서와 함수별 (인자, 값 개수)."""
    return [(name, [(arg, len(values)) for arg, values in args.items()]) for name, args, _ in spec_v2.FUNCTIONS]


def check_prompt(data: dict) -> list[str]:
    """`cropy_prompt.json` (서버·보드 모델 폴더)."""
    errors = []
    functions = data.get("functions")
    if not isinstance(functions, dict):
        return ["cropy_prompt.json에 functions가 없다"]
    got = [(name, [(arg, count) for arg, count in args]) for name, args in functions.items()]
    if got != spec_signature():
        errors.append(f"cropy_prompt.json 함수·인자가 spec_v2와 다르다: {got}")
    tokens = data.get("new_tokens", {})
    expected_tokens = spec_v2.NEW_TOKENS
    if list(tokens) != expected_tokens:
        errors.append(f"cropy_prompt.json new_tokens가 {expected_tokens}와 다르다: {list(tokens)}")
    if data.get("stop_token") != spec_v2.END:
        errors.append(f"stop_token이 {spec_v2.END}가 아니다: {data.get('stop_token')}")
    return errors


def check_labels(data: dict) -> list[str]:
    """`labels.json` (휴대폰 분류기). 함수 순서가 같아야 하고, 인자 값은 spec 값의 앞에서부터 같은 이름이어야 한다."""
    errors = []
    if data.get("functions") != spec_v2.NAMES:
        errors.append(f"labels.json functions 순서가 spec_v2와 다르다: {data.get('functions')}")
    spec_args = {name: args for name, args, _ in spec_v2.FUNCTIONS}
    for head in data.get("heads", []):
        fn, arg, values = head.get("function"), head.get("argument"), head.get("values", [])
        expected = [value for value, _ in spec_args.get(fn, {}).get(arg, [])]
        if not expected:
            errors.append(f"labels.json에 spec_v2에 없는 인자가 있다: {fn}.{arg}")
        elif values != expected:
            errors.append(f"labels.json {fn}.{arg} 값이 spec_v2와 다르다: {values} != {expected}")
    covered = {(h.get("function"), h.get("argument")) for h in data.get("heads", [])}
    for name, args, _ in spec_v2.FUNCTIONS:
        for arg in args:
            if (name, arg) not in covered:
                errors.append(f"labels.json에 {name}.{arg} 헤드가 없다")
    return errors


def check_folder(kind: str, folder: Path, manifest: dict, write: bool = False) -> list[str]:
    asset = manifest["assets"].get(kind)
    if asset is None:
        return [f"model_assets.json에 {kind}가 없다 (가능: {', '.join(manifest['assets'])})"]
    errors = []
    for name, info in asset["files"].items():
        path = folder / name
        if not path.is_file():
            errors.append(f"파일 없음: {name}")
            continue
        size = path.stat().st_size
        if size != info["bytes"]:
            errors.append(f"크기 다름: {name} {size} != {info['bytes']}")
            continue
        digest = sha256(path)
        if info.get("sha256") is None:
            if write:
                info["sha256"] = digest
            else:
                print(f"  (기록 없음) {name} sha256={digest}")
        elif digest != info["sha256"]:
            errors.append(f"SHA-256 다름: {name}")
    contract = folder / "cropy_prompt.json"
    if kind in ("server", "board_rkllm") and contract.is_file():
        errors += check_prompt(json.loads(contract.read_text(encoding="utf-8")))
    labels = folder / "labels.json"
    if kind == "mobile_clf" and labels.is_file():
        errors += check_labels(json.loads(labels.read_text(encoding="utf-8")))
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kind", help="server | mobile_clf | web_qwen | board_rkllm")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--write", action="store_true", help="sha256이 비어 있는 항목을 model_assets.json에 기록한다")
    args = parser.parse_args(argv)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    errors = check_folder(args.kind, args.folder, manifest, write=args.write)
    if args.write and not errors:
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for error in errors:
        print("실패:", error)
    print("통과" if not errors else f"실패 {len(errors)}건")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
