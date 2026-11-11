"""Score a W8A8 RKLLM build on the held-out real-speech rows with the PC simulator (rkllm-toolkit venv).

The toolkit cannot load an exported .rkllm back, so this rebuilds the quantized model from the merged HF model with the
same settings and the same calibration file (data_quant.json saved next to that .rkllm) as convert_rkllm.py, then runs
the same greedy decoding over llm.get_logits(). The rebuilt model is not exported.

Writes to --out-dir
  sim_<quant>_real_speech_<tag>_cases.jsonl     one row per utterance (appended, so a rerun resumes)
  sim_<quant>_real_speech_<tag>_metrics.json    function / exact (rows with a gold call) / agreement with float
"""
import argparse
import hashlib
import json
import lzma
import re
import time
from collections.abc import Mapping
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--model-dir", required=True)
ap.add_argument("--calib", required=True, help="data_quant.json used for the board build of this model")
ap.add_argument("--data", required=True)
ap.add_argument("--data-sha", required=True)
ap.add_argument("--out-dir", required=True)
ap.add_argument("--tag", required=True)
ap.add_argument("--reference-cases", default="", help="float outputs on the same rows (merge_eval_soup6/*_real_speech_cases.jsonl)")
ap.add_argument("--quant", default="w8a8")
ap.add_argument("--algorithm", default="normal")
ap.add_argument("--optimization-level", type=int, default=1)
ap.add_argument("--platform", default="rk3588")
ap.add_argument("--npu-cores", type=int, default=3)
ap.add_argument("--max-context", type=int, default=2048)
ap.add_argument("--device", default="cuda")
args = ap.parse_args()

import torch
from rkllm.api import RKLLM
from transformers import AutoTokenizer

model_dir, out = Path(args.model_dir), Path(args.out_dir)
out.mkdir(parents=True, exist_ok=True)
prompt = json.loads((model_dir / "cropy_prompt.json").read_text(encoding="utf-8"))
SYSTEM, FUNCTIONS, STOP = prompt["system_prompt"], prompt["functions"], prompt["stop_token"]
NAMES = list(FUNCTIONS)
END_ID = prompt["new_tokens"][STOP]
raw = Path(args.data).read_bytes()
assert hashlib.sha256(raw).hexdigest() == args.data_sha, "데이터 파일이 노트북과 다릅니다"
rows = [r for r in map(json.loads, lzma.decompress(raw).decode("utf-8").splitlines()) if r["split"] == "real_speech"]
assert rows, "데이터에 real_speech 행이 없습니다"
tok = AutoTokenizer.from_pretrained(model_dir)
EOS_ID = tok.eos_token_id


def render(r):  # same as prepare_rkllm.py
    user = json.dumps({"utterance": r["user_text"], "context": r["context"]}, ensure_ascii=False, separators=(",", ":"))
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
    tids = tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, enable_thinking=False)
    if isinstance(tids, Mapping):
        tids = tids["input_ids"]
    tids = tids.tolist() if hasattr(tids, "tolist") else list(tids)
    return tids[0] if tids and isinstance(tids[0], list) else tids


CALL = re.compile(r"^<hs_(\d+)>\(((?:[a-z_]+=-?\d+(?:, [a-z_]+=-?\d+)*)?)\)<hs_end>$")


def parse_call(text):  # same as convert_rkllm.py
    m = CALL.match(text.strip())
    if not m or int(m.group(1)) >= len(NAMES):
        return None
    name = NAMES[int(m.group(1))]
    given = [p.split("=") for p in m.group(2).split(", ")] if m.group(2) else []
    if [k for k, _ in given] != [a for a, _ in FUNCTIONS[name]]:
        return None
    if any(not 1 <= int(v) <= n for (_, v), (_, n) in zip(given, FUNCTIONS[name])):
        return None
    return name, tuple(int(v) for _, v in given)


llm = RKLLM()
start = time.time()
assert llm.load_huggingface(model=str(model_dir), model_lora=None, device=args.device, dtype="float32",
                            custom_config=None, load_weight=True) == 0, "모델 불러오기 실패"
assert llm.build(do_quantization=True, optimization_level=args.optimization_level, quantized_dtype=args.quant,
                 quantized_algorithm=args.algorithm, target_platform=args.platform, num_npu_core=args.npu_cores,
                 extra_qparams=None, dataset=str(args.calib), hybrid_rate=0,
                 max_context=args.max_context) == 0, "양자화(build) 실패"
build_seconds = round(time.time() - start)
print(f"양자화 완료 {build_seconds}초")

ref = {}
if args.reference_cases and Path(args.reference_cases).exists():
    ref = {c["case_id"]: c["actual"] for c in map(json.loads, Path(args.reference_cases).read_text(encoding="utf-8").splitlines())}


def greedy(input_ids):
    ids, new = list(input_ids), []
    for _ in range(16):
        with torch.no_grad():
            logits = llm.get_logits({"input_ids": torch.tensor([ids], dtype=torch.long)})
        nxt = int(logits[0, -1].argmax())
        new.append(nxt)
        ids.append(nxt)
        if nxt in (END_ID, EOS_ID):
            break
    if new and new[-1] == EOS_ID:
        new = new[:-1]
    return tok.decode(new, skip_special_tokens=False).strip()


name = f"sim_{args.quant}_real_speech_{args.tag}"
sim_file = out / f"{name}_cases.jsonl"
done = {}
if sim_file.exists():
    done = {c["case_id"]: c for c in map(json.loads, sim_file.read_text(encoding="utf-8").splitlines())}
start = time.time()
with sim_file.open("a", encoding="utf-8") as f:
    todo = [r for r in rows if r["case_id"] not in done]
    for i, r in enumerate(todo, 1):
        text = greedy(render(r))
        got = parse_call(text)
        row = dict(case_id=r["case_id"], function=r["function"], user_text=r["user_text"], expected=r["output"],
                   actual=text, float_actual=ref.get(r["case_id"]), format_valid=got is not None,
                   function_correct=bool(got) and got[0] == r["function"],
                   exact_correct=None if r["output"] is None else text == r["output"])
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
        f.flush()
        done[r["case_id"]] = row
        if i in (1, 5) or i % 25 == 0:
            per = (time.time() - start) / i
            print(f"  {i}/{len(todo)} 건, 건당 {per:.1f}초, 남은 시간 약 {per * (len(todo) - i) / 60:.0f}분 | {text}")

res = [done[r["case_id"]] for r in rows]


def rate(key, rs=res):
    rs = [r for r in rs if r[key] is not None]
    return round(sum(r[key] for r in rs) / max(1, len(rs)), 4)


with_ref = [r for r in res if r["float_actual"] is not None and r["expected"] is not None]
per_fn = {}
for fn in sorted({r["function"] for r in res}):
    rs = [r for r in res if r["function"] == fn]
    per_fn[fn] = dict(support=len(rs), function=rate("function_correct", rs), exact=rate("exact_correct", rs))
metrics = dict(
    quant=args.quant, tag=args.tag, split="real_speech", calib=Path(args.calib).name,
    calib_sha256=hashlib.sha256(Path(args.calib).read_bytes()).hexdigest(), build_seconds=build_seconds,
    support=len(res), exact_support=sum(r["exact_correct"] is not None for r in res), format_valid=rate("format_valid"),
    function=rate("function_correct"), exact=rate("exact_correct"),
    float_exact_same_rows=round(sum(r["float_actual"] == r["expected"] for r in with_ref) / len(with_ref), 4) if with_ref else None,
    same_as_float=round(sum(r["actual"] == r["float_actual"] for r in with_ref) / len(with_ref), 4) if with_ref else None,
    per_function=per_fn)
(out / f"{name}_metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
errors = [r for r in res if r["exact_correct"] is False or (r["exact_correct"] is None and not r["function_correct"])]
(out / f"{name}_errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps({k: metrics[k] for k in ("support", "exact_support", "format_valid", "function", "exact",
                                          "float_exact_same_rows", "same_as_float")}, ensure_ascii=False))
