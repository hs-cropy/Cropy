"""Prepare the RKLLM conversion of the deployed Qwen model (runs inside the rkllm-toolkit venv).

Uses the transformers version rkllm-toolkit pins, so every check here is what the converter will see.

Writes to --out-dir
  data_quant.json     calibration set for llm.build(): [{"input": full prompt text, "target": call}], train split
  eval_cases.jsonl    every validation row with the exact prompt text and token ids, for the PC simulation and the board
  prepare_report.json token checks, prompt lengths and (if a GPU is there) a float check under this transformers version

Checks
  - the 10 new tokens (<hs_0>~<hs_8>, <hs_end>) are single tokens with the ids recorded in cropy_prompt.json
  - tokenizing the rendered prompt text gives the same ids as apply_chat_template (the board feeds text or ids)
  - the float model loaded by this transformers version answers like the saved Colab outputs (weights load right)
"""
import argparse
import collections
import hashlib
import json
import lzma
import random
import time
from collections.abc import Mapping
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--model-dir", required=True)
ap.add_argument("--data", required=True, help="qwen_v2c_data.jsonl.xz")
ap.add_argument("--data-sha", required=True)
ap.add_argument("--out-dir", required=True)
ap.add_argument("--reference-cases", default="", help="merge_eval/soup_*_b1_cases.jsonl (float outputs saved in Colab)")
ap.add_argument("--calib-n", type=int, default=64)
ap.add_argument("--float-check-n", type=int, default=64)
ap.add_argument("--device", default="cuda", help="cpu skips the float check (slow there)")
ap.add_argument("--seed", type=int, default=20261105)
args = ap.parse_args()

import torch
import transformers
from transformers import AutoTokenizer

model_dir, out = Path(args.model_dir), Path(args.out_dir)
out.mkdir(parents=True, exist_ok=True)
prompt = json.loads((model_dir / "cropy_prompt.json").read_text(encoding="utf-8"))
SYSTEM, FUNCTIONS, STOP = prompt["system_prompt"], prompt["functions"], prompt["stop_token"]
raw = Path(args.data).read_bytes()
assert hashlib.sha256(raw).hexdigest() == args.data_sha, "데이터 파일이 노트북과 다릅니다"
rows = [json.loads(l) for l in lzma.decompress(raw).decode("utf-8").splitlines()]
train = [r for r in rows if r["split"] == "train"]
val = [r for r in rows if r["split"] == "validation"]
report = dict(transformers=transformers.__version__, torch=torch.__version__, train=len(train), validation=len(val))

# 1. new tokens
tok = AutoTokenizer.from_pretrained(model_dir)
ids = {t: tok.encode(t, add_special_tokens=False) for t in prompt["new_tokens"]}
assert all(len(v) == 1 for v in ids.values()), f"새 토큰이 한 토큰이 아닙니다: {ids}"
ids = {t: v[0] for t, v in ids.items()}
assert ids == prompt["new_tokens"], f"토큰 번호가 학습 때와 다릅니다: {ids} vs {prompt['new_tokens']}"
assert tok.decode([ids[STOP]], skip_special_tokens=False) == STOP
report["new_tokens"] = ids
report["eos_token"] = [tok.eos_token, tok.eos_token_id]


# 2. prompts: same construction as training (system prompt + compact JSON user turn, thinking off)
def render(r):
    user = json.dumps({"utterance": r["user_text"], "context": r["context"]}, ensure_ascii=False, separators=(",", ":"))
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
    text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    tids = tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, enable_thinking=False)
    if isinstance(tids, Mapping):
        tids = tids["input_ids"]
    tids = tids.tolist() if hasattr(tids, "tolist") else list(tids)
    tids = tids[0] if tids and isinstance(tids[0], list) else tids
    return text, tids


mismatch, lengths = 0, []
with (out / "eval_cases.jsonl").open("w", encoding="utf-8") as f:
    for r in val:
        text, tids = render(r)
        mismatch += tok(text, add_special_tokens=False)["input_ids"] != tids
        lengths.append(len(tids))
        f.write(json.dumps(dict(case_id=r["case_id"], function=r["function"], augmentation=r["augmentation"],
                                user_text=r["user_text"], prompt=text, input_ids=tids, expected=r["output"]),
                           ensure_ascii=False) + "\n")
report["text_vs_template_id_mismatch"] = mismatch
report["prompt_tokens"] = dict(min=min(lengths), max=max(lengths), mean=round(sum(lengths) / len(lengths)))
print("평가 입력", len(val), "건, 프롬프트 토큰", report["prompt_tokens"], "| 텍스트↔토큰 불일치", mismatch)
assert mismatch == 0, "프롬프트 텍스트를 다시 토큰화하면 학습 때 토큰과 달라집니다"

# 3. calibration: real inputs, spread over functions (train split only, never validation)
rng = random.Random(args.seed)
by_fn = collections.defaultdict(list)
for r in train:
    by_fn[r["function"]].append(r)
picked = []
for fn in sorted(by_fn):
    rng.shuffle(by_fn[fn])
while len(picked) < args.calib_n and any(by_fn.values()):
    for fn in sorted(by_fn):
        if by_fn[fn] and len(picked) < args.calib_n:
            picked.append(by_fn[fn].pop())
calib = [dict(input=render(r)[0], target=r["output"]) for r in picked]
(out / "data_quant.json").write_text(json.dumps(calib, ensure_ascii=False), encoding="utf-8")
report["calibration"] = dict(n=len(calib), by_function=dict(collections.Counter(r["function"] for r in picked)))
print("보정 데이터", report["calibration"])

# 4. float check under this transformers version (catches weight-name changes between versions)
if args.float_check_n and args.device == "cuda":
    cls = getattr(transformers, "Qwen3_5ForConditionalGeneration", None) or transformers.AutoModelForImageTextToText
    model = cls.from_pretrained(model_dir, dtype=torch.bfloat16, device_map={"": 0}, attn_implementation="sdpa").eval()
    ref = {}
    if args.reference_cases and Path(args.reference_cases).exists():
        ref = {c["case_id"]: c["actual"] for c in map(json.loads, Path(args.reference_cases).read_text(encoding="utf-8").splitlines())}
    cases = [json.loads(l) for l in (out / "eval_cases.jsonl").read_text(encoding="utf-8").splitlines()][:args.float_check_n]
    same = exact = 0
    start = time.time()
    for c in cases:
        with torch.no_grad():
            g = model.generate(input_ids=torch.tensor([c["input_ids"]], device=model.device), max_new_tokens=16,
                               do_sample=False, eos_token_id=[ids[STOP], tok.eos_token_id],
                               pad_token_id=tok.pad_token_id or tok.eos_token_id)
        seq = g[0, len(c["input_ids"]):].tolist()
        seq = seq[:seq.index(ids[STOP]) + 1] if ids[STOP] in seq else seq
        text = tok.decode(seq, skip_special_tokens=False).strip()
        exact += text == c["expected"]
        same += text == ref.get(c["case_id"])
    report["float_check"] = dict(n=len(cases), exact=exact, same_as_colab=same if ref else None,
                                 seconds=round(time.time() - start))
    print("float 확인", report["float_check"])
    del model
    torch.cuda.empty_cache()
else:
    report["float_check"] = None
    print("CPU로 실행해 float 확인을 건너뜀")

(out / "prepare_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("완료", out)
