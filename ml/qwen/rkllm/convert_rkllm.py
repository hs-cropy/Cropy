"""Convert the deployed Qwen model to an int8 RKLLM model and simulate it on the PC (rkllm-toolkit venv).

Needs prepare_rkllm.py output in --work-dir (data_quant.json, eval_cases.jsonl, prepare_report.json).

Writes to --work-dir
  cropy_qwen_<quant>_<platform>.rkllm   the model for the board
  sim_<quant>_cases.jsonl               quantized-model answers on a validation subset (appended, so a rerun resumes)
  sim_<quant>_metrics.json              format / function / exact rate, and agreement with the float answers

The simulation uses llm.get_logits() (RKLLM's PC-side quantized forward) with greedy decoding we drive
ourselves, so special tokens like <hs_4> are never dropped by a decoder. The board must also keep them:
set RKLLMParam.skip_special_token = false there.
"""
import argparse
import json
import random
import re
import time
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--model-dir", required=True)
ap.add_argument("--work-dir", required=True)
ap.add_argument("--quant", default="w8a8", help="w8a8, w8a8_g128, w8a8_g256, w8a8_g512 ...")
ap.add_argument("--algorithm", default="normal")
ap.add_argument("--optimization-level", type=int, default=1)
ap.add_argument("--platform", default="rk3588")
ap.add_argument("--npu-cores", type=int, default=3)
ap.add_argument("--max-context", type=int, default=2048)
ap.add_argument("--device", default="cuda")
ap.add_argument("--sim-n", type=int, default=300, help="validation rows to simulate (0 = skip, -1 = all)")
ap.add_argument("--reference-cases", default="", help="float outputs saved in Colab, to measure agreement")
ap.add_argument("--seed", type=int, default=20261105)
args = ap.parse_args()

import torch
from rkllm.api import RKLLM

work, model_dir = Path(args.work_dir), Path(args.model_dir)
prompt = json.loads((model_dir / "cropy_prompt.json").read_text(encoding="utf-8"))
FUNCTIONS, STOP = prompt["functions"], prompt["stop_token"]
NAMES = list(FUNCTIONS)
END_ID = prompt["new_tokens"][STOP]
report = json.loads((work / "prepare_report.json").read_text(encoding="utf-8"))
EOS_ID = report["eos_token"][1]
assert report["prompt_tokens"]["max"] + 32 <= args.max_context, "max_context가 가장 긴 프롬프트보다 짧습니다"
assert args.max_context % 32 == 0
rkllm_path = work / f"cropy_qwen_{args.quant}_{args.platform}.rkllm"

llm = RKLLM()
start = time.time()
assert llm.load_huggingface(model=str(model_dir), model_lora=None, device=args.device, dtype="float32",
                            custom_config=None, load_weight=True) == 0, "모델 불러오기 실패"
assert llm.build(do_quantization=True, optimization_level=args.optimization_level, quantized_dtype=args.quant,
                 quantized_algorithm=args.algorithm, target_platform=args.platform, num_npu_core=args.npu_cores,
                 extra_qparams=None, dataset=str(work / "data_quant.json"), hybrid_rate=0,
                 max_context=args.max_context) == 0, "양자화(build) 실패"
assert llm.export_rkllm(str(rkllm_path)) == 0, "내보내기 실패"
convert_seconds = round(time.time() - start)
print(f"변환 완료 {rkllm_path.name} {rkllm_path.stat().st_size / 2**30:.2f}GB, {convert_seconds}초")

CALL = re.compile(r"^<hs_(\d+)>\(((?:[a-z_]+=-?\d+(?:, [a-z_]+=-?\d+)*)?)\)<hs_end>$")


def parse_call(text):
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


if args.sim_n:
    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(model_dir)
    cases = [json.loads(l) for l in (work / "eval_cases.jsonl").read_text(encoding="utf-8").splitlines()]
    if args.sim_n > 0:
        cases = random.Random(args.seed).sample(cases, min(args.sim_n, len(cases)))
    ref = {}
    if args.reference_cases and Path(args.reference_cases).exists():
        ref = {c["case_id"]: c["actual"] for c in map(json.loads, Path(args.reference_cases).read_text(encoding="utf-8").splitlines())}

    # one quick look at the toolkit's own text generation (may drop special tokens; not used for scoring)
    try:
        print("chat_model 예시:", repr(llm.chat_model(cases[0]["prompt"], {"max_new_tokens": 16, "top_k": 1, "do_sample": False})))
    except Exception as e:  # noqa: BLE001 - informational only
        print("chat_model 예시 실패:", e)

    def greedy(input_ids):
        ids = list(input_ids)
        new = []
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

    sim_file = work / f"sim_{args.quant}_cases.jsonl"
    done = {}
    if sim_file.exists():
        done = {c["case_id"]: c for c in map(json.loads, sim_file.read_text(encoding="utf-8").splitlines())}
    start = time.time()
    with sim_file.open("a", encoding="utf-8") as f:
        todo = [c for c in cases if c["case_id"] not in done]
        for i, c in enumerate(todo, 1):
            text = greedy(c["input_ids"])
            got, gold = parse_call(text), parse_call(c["expected"])
            row = dict(case_id=c["case_id"], function=c["function"], user_text=c["user_text"], expected=c["expected"],
                       actual=text, float_actual=ref.get(c["case_id"]), format_valid=got is not None,
                       function_correct=bool(got) and got[0] == gold[0], exact_correct=text == c["expected"])
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            f.flush()
            done[c["case_id"]] = row
            if i in (1, 5) or i % 25 == 0:
                per = (time.time() - start) / i
                print(f"  {i}/{len(todo)} 건, 건당 {per:.1f}초, 남은 시간 약 {per * (len(todo) - i) / 60:.0f}분 | {text}")

    rows = [done[c["case_id"]] for c in cases]
    rate = lambda key, rs=rows: round(sum(r[key] for r in rs) / max(1, len(rs)), 4)  # noqa: E731
    with_ref = [r for r in rows if r["float_actual"] is not None]
    per_fn = {}
    for fn in sorted({r["function"] for r in rows}):
        rs = [r for r in rows if r["function"] == fn]
        per_fn[fn] = dict(support=len(rs), function=rate("function_correct", rs), exact=rate("exact_correct", rs))
    metrics = dict(
        quant=args.quant, algorithm=args.algorithm, optimization_level=args.optimization_level, platform=args.platform,
        max_context=args.max_context, rkllm_file=rkllm_path.name, rkllm_gb=round(rkllm_path.stat().st_size / 2**30, 3),
        convert_seconds=convert_seconds, support=len(rows), format_valid=rate("format_valid"),
        function=rate("function_correct"), exact=rate("exact_correct"),
        float_exact_same_rows=round(sum(r["float_actual"] == r["expected"] for r in with_ref) / max(1, len(with_ref)), 4) if with_ref else None,
        same_as_float=round(sum(r["actual"] == r["float_actual"] for r in with_ref) / max(1, len(with_ref)), 4) if with_ref else None,
        per_function=per_fn)
    (work / f"sim_{args.quant}_metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: metrics[k] for k in ("support", "format_valid", "function", "exact", "float_exact_same_rows", "same_as_float")}, ensure_ascii=False))
