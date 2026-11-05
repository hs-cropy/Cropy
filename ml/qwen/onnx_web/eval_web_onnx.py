"""Score a browser bundle (export_web_onnx.py output) with ONNX Runtime on validation rows.

Runs the exact graphs the browser runs (embed_tokens + decoder_model_merged with linear-attention states and KV cache)
with greedy decoding we drive ourselves, so <hs_*> tokens are never dropped. The subset is the same 300 validation
rows the RKLLM simulation used (seed 20261105 over validation order), so float / int8 / q4 are directly comparable.

Writes to --out-dir: web_<dtype>_cases.jsonl, web_<dtype>_metrics.json
"""
import argparse
import hashlib
import json
import lzma
import random
import re
import time
from collections.abc import Mapping
from pathlib import Path

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--bundle", required=True)
ap.add_argument("--data", required=True)
ap.add_argument("--data-sha", required=True)
ap.add_argument("--dtype", default="q4f16")
ap.add_argument("--out-dir", required=True)
ap.add_argument("--sim-n", type=int, default=300, help="-1 = all validation rows")
ap.add_argument("--reference-cases", default="", help="float outputs (case_id -> actual) of the same model")
ap.add_argument("--device", default="cuda")
ap.add_argument("--seed", type=int, default=20261105)
args = ap.parse_args()

import onnxruntime as ort  # noqa: E402
from transformers import AutoTokenizer  # noqa: E402

bundle, out = Path(args.bundle), Path(args.out_dir)
out.mkdir(parents=True, exist_ok=True)
prompt = json.loads((bundle / "cropy_prompt.json").read_text(encoding="utf-8"))
SYSTEM, FUNCTIONS, STOP = prompt["system_prompt"], prompt["functions"], prompt["stop_token"]
NAMES = list(FUNCTIONS)
END_ID = prompt["new_tokens"][STOP]
tok = AutoTokenizer.from_pretrained(bundle)
assert tok.convert_tokens_to_ids(STOP) == END_ID
gen_cfg = json.loads((bundle / "generation_config.json").read_text())
eos = gen_cfg["eos_token_id"]
STOP_IDS = {END_ID, *(eos if isinstance(eos, list) else [eos])}

raw = Path(args.data).read_bytes()
assert hashlib.sha256(raw).hexdigest() == args.data_sha
val = [r for r in map(json.loads, lzma.decompress(raw).decode("utf-8").splitlines()) if r["split"] == "validation"]
cases = val if args.sim_n < 0 else random.Random(args.seed).sample(val, min(args.sim_n, len(val)))
ref = {}
if args.reference_cases and Path(args.reference_cases).exists():
    ref = {c["case_id"]: c["actual"] for c in map(json.loads, Path(args.reference_cases).read_text(encoding="utf-8").splitlines())}


def prompt_ids(r):
    user = json.dumps({"utterance": r["user_text"], "context": r["context"]}, ensure_ascii=False, separators=(",", ":"))
    ids = tok.apply_chat_template([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
                                  tokenize=True, add_generation_prompt=True, enable_thinking=False)
    if isinstance(ids, Mapping):
        ids = ids["input_ids"]
    ids = ids.tolist() if hasattr(ids, "tolist") else list(ids)
    return ids[0] if ids and isinstance(ids[0], list) else ids


providers = (["CUDAExecutionProvider"] if args.device == "cuda" else []) + ["CPUExecutionProvider"]
opts = ort.SessionOptions()
embed = ort.InferenceSession(str(bundle / "onnx" / f"embed_tokens_{args.dtype}.onnx"), opts, providers=providers)
dec = ort.InferenceSession(str(bundle / "onnx" / f"decoder_model_merged_{args.dtype}.onnx"), opts, providers=providers)
print("providers", dec.get_providers())
NP = {"tensor(float)": np.float32, "tensor(float16)": np.float16, "tensor(int64)": np.int64}
inputs = {i.name: i for i in dec.get_inputs()}
FIXED = {"inputs_embeds", "attention_mask", "position_ids", "num_logits_to_keep"}
past_names = [n for n in inputs if n not in FIXED]


def empty_state():
    state = {}
    for n in past_names:
        shape = [1 if (isinstance(d, str) and "batch" in d) else 0 if isinstance(d, str) else d for d in inputs[n].shape]
        state[n] = np.zeros(shape, NP[inputs[n].type])
    return state


def past_of(output_name):
    if output_name.startswith("present_"):
        return "past_" + output_name[len("present_"):]
    if output_name.startswith("present."):
        return "past_key_values." + output_name[len("present."):]
    return None


out_names = [o.name for o in dec.get_outputs()]
assert sorted(filter(None, map(past_of, out_names))) == sorted(past_names), (out_names[:6], past_names[:6])
EMB_T = NP[inputs["inputs_embeds"].type]


def step(ids, start, state):
    emb = embed.run(None, {"input_ids": np.array([ids], np.int64)})[0].astype(EMB_T)
    n = len(ids)
    feed = dict(state)
    feed["inputs_embeds"] = emb
    feed["attention_mask"] = np.ones((1, start + n), np.int64)
    feed["position_ids"] = np.tile(np.arange(start, start + n, dtype=np.int64)[None, None, :], (3, 1, 1))
    if "num_logits_to_keep" in inputs:
        feed["num_logits_to_keep"] = np.array(1, np.int64)
    res = dict(zip(out_names, dec.run(out_names, feed)))
    new_state = {past_of(k): v for k, v in res.items() if past_of(k)}
    return int(np.argmax(res["logits"][0, -1])), new_state


def greedy(ids):
    t0 = time.time()
    nxt, state = step(ids, 0, empty_state())
    prefill = time.time() - t0
    new, pos = [nxt], len(ids)
    while new[-1] not in STOP_IDS and len(new) < 16:
        nxt, state = step([new[-1]], pos, state)
        pos += 1
        new.append(nxt)
    if new[-1] in STOP_IDS and new[-1] != END_ID:
        new = new[:-1]
    return tok.decode(new, skip_special_tokens=False).strip(), prefill, time.time() - t0


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


rows, start = [], time.time()
for i, r in enumerate(cases, 1):
    ids = prompt_ids(r)
    text, prefill, total = greedy(ids)
    got, gold = parse_call(text), parse_call(r["output"])
    rows.append(dict(case_id=r["case_id"], function=r["function"], user_text=r["user_text"], expected=r["output"],
                     actual=text, float_actual=ref.get(r["case_id"]), prompt_tokens=len(ids), prefill_s=round(prefill, 3),
                     total_s=round(total, 3), format_valid=got is not None,
                     function_correct=bool(got) and got[0] == gold[0], exact_correct=text == r["output"]))
    if i in (1, 5) or i % 50 == 0:
        per = (time.time() - start) / i
        print(f"  {i}/{len(cases)} 건당 {per:.2f}초 (prefill {prefill:.2f}초) | {text}")

with (out / f"web_{args.dtype}_cases.jsonl").open("w", encoding="utf-8") as f:
    for row in rows:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
rate = lambda key, rs=rows: round(sum(r[key] for r in rs) / max(1, len(rs)), 4)  # noqa: E731
with_ref = [r for r in rows if r["float_actual"] is not None]
per_fn = {fn: dict(support=len(rs), function=rate("function_correct", rs), exact=rate("exact_correct", rs))
          for fn in sorted({r["function"] for r in rows}) for rs in [[r for r in rows if r["function"] == fn]]}
metrics = dict(dtype=args.dtype, providers=dec.get_providers(), support=len(rows), format_valid=rate("format_valid"),
               function=rate("function_correct"), exact=rate("exact_correct"),
               float_exact_same_rows=round(sum(r["float_actual"] == r["expected"] for r in with_ref) / len(with_ref), 4) if with_ref else None,
               same_as_float=round(sum(r["actual"] == r["float_actual"] for r in with_ref) / len(with_ref), 4) if with_ref else None,
               mean_prefill_s=round(float(np.mean([r["prefill_s"] for r in rows])), 3),
               mean_total_s=round(float(np.mean([r["total_s"] for r in rows])), 3), per_function=per_fn)
(out / f"web_{args.dtype}_metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2))
print(json.dumps({k: metrics[k] for k in ("dtype", "support", "format_valid", "function", "exact", "float_exact_same_rows",
                                          "same_as_float", "mean_prefill_s")}, ensure_ascii=False))
