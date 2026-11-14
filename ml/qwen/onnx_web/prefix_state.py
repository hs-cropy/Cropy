"""Precompute the decoder state after the fixed system prompt, so a phone only prefills the user turn.

Every Cropy prompt starts with the same ~1,100 tokens (chat template + system prompt with the function list); only the
utterance and context (~170 tokens) change. Running those 1,100 tokens on an iPhone is what killed the tab, and they give
the same state every time, so we run them once here with the very graphs the browser runs and ship the result.

The state is what the merged decoder returns after the prefix: full-attention KV (grows with length) and linear-attention
conv / recurrent states (fixed size). The browser feeds it back as past_* inputs and starts the user turn at position P.

Output (next to the bundle files):
  prefix_<dtype>.bin    raw tensors back to back, each 64-byte aligned, little-endian
  prefix_<dtype>.json   prefix_ids, tensor table (name -> dtype, shape, offset, bytes), checks (sha256 of the system
                        prompt and the decoder data) so the app can refuse a state made for another model or prompt

The prefix is the longest token run shared by any two prompts (found by rendering two different user turns), then
checked against every validation and train row of --data. At run time the app must still compare prompt_ids[:P] with
prefix_ids and fall back to a full prefill on mismatch.
"""
import argparse
import hashlib
import json
import lzma
from pathlib import Path

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--bundle", required=True)
ap.add_argument("--dtype", default="q4f16")
ap.add_argument("--data", default="", help="qwen_v2c_data.jsonl.xz: check the prefix against every row")
ap.add_argument("--threads", type=int, default=0)
args = ap.parse_args()

import onnxruntime as ort  # noqa: E402
from transformers import AutoTokenizer  # noqa: E402

bundle = Path(args.bundle)
prompt = json.loads((bundle / "cropy_prompt.json").read_text(encoding="utf-8"))
SYSTEM = prompt["system_prompt"]
tok = AutoTokenizer.from_pretrained(bundle)


def prompt_ids(user_text, context):
    user = json.dumps({"utterance": user_text, "context": context}, ensure_ascii=False, separators=(",", ":"))
    ids = tok.apply_chat_template([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
                                  tokenize=True, add_generation_prompt=True, enable_thinking=False)
    if hasattr(ids, "keys"):
        ids = ids["input_ids"]
    ids = ids.tolist() if hasattr(ids, "tolist") else list(ids)
    return ids[0] if ids and isinstance(ids[0], list) else ids


a, b = prompt_ids("가", {}), prompt_ids("나다", {"x": 1})
P = next(i for i, (x, y) in enumerate(zip(a, b)) if x != y)
prefix = a[:P]
print("prefix tokens", P, "| ends with", repr(tok.decode(prefix[-6:])))
checked = 0
if args.data:
    for line in lzma.decompress(Path(args.data).read_bytes()).decode("utf-8").splitlines():
        r = json.loads(line)
        assert prompt_ids(r["user_text"], r["context"])[:P] == prefix, r["case_id"]
        checked += 1
    print("prefix identical on", checked, "rows")

opts = ort.SessionOptions()
if args.threads:
    opts.intra_op_num_threads = args.threads
embed = ort.InferenceSession(str(bundle / "onnx" / f"embed_tokens_{args.dtype}.onnx"), opts, providers=["CPUExecutionProvider"])
dec = ort.InferenceSession(str(bundle / "onnx" / f"decoder_model_merged_{args.dtype}.onnx"), opts, providers=["CPUExecutionProvider"])
NP = {"tensor(float)": np.float32, "tensor(float16)": np.float16, "tensor(int64)": np.int64}
inputs = {i.name: i for i in dec.get_inputs()}
FIXED = {"inputs_embeds", "attention_mask", "position_ids", "num_logits_to_keep"}
past_names = [n for n in inputs if n not in FIXED]


def past_of(name):
    if name.startswith("present_"):
        return "past_" + name[len("present_"):]
    if name.startswith("present."):
        return "past_key_values." + name[len("present."):]
    return None


feed = {}
for n in past_names:
    shape = [1 if (isinstance(d, str) and "batch" in d) else 0 if isinstance(d, str) else d for d in inputs[n].shape]
    feed[n] = np.zeros(shape, NP[inputs[n].type])
feed["inputs_embeds"] = embed.run(None, {"input_ids": np.array([prefix], np.int64)})[0].astype(NP[inputs["inputs_embeds"].type])
feed["attention_mask"] = np.ones((1, P), np.int64)
feed["position_ids"] = np.tile(np.arange(P, dtype=np.int64)[None, None, :], (3, 1, 1))
if "num_logits_to_keep" in inputs:
    feed["num_logits_to_keep"] = np.array(1, np.int64)
out_names = [o.name for o in dec.get_outputs()]
res = dict(zip(out_names, dec.run(out_names, feed)))
state = {past_of(k): np.ascontiguousarray(v) for k, v in res.items() if past_of(k)}
assert sorted(state) == sorted(past_names)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 24), b""):
            h.update(chunk)
    return h.hexdigest()


table, offset = {}, 0
bin_path = bundle / f"prefix_{args.dtype}.bin"
with bin_path.open("wb") as f:
    for name in past_names:  # graph input order
        arr = state[name]
        pad = (-offset) % 64
        f.write(b"\0" * pad)
        offset += pad
        data = arr.astype(arr.dtype.newbyteorder("<"), copy=False).tobytes()
        f.write(data)
        table[name] = dict(dtype=str(arr.dtype), shape=list(arr.shape), offset=offset, bytes=len(data))
        offset += len(data)
decoder_data = sorted((bundle / "onnx").glob(f"decoder_model_merged_{args.dtype}.onnx_data*"))
meta = dict(dtype=args.dtype, prefix_len=P, prefix_ids=prefix, tensors=table, bin_bytes=offset,
            system_prompt_sha256=hashlib.sha256(SYSTEM.encode("utf-8")).hexdigest(),
            decoder_data_sha256={p.name: sha256(p) for p in decoder_data}, rows_checked=checked)
(bundle / f"prefix_{args.dtype}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
kinds = {}
for name, t in table.items():
    kind = "kv" if (".key" in name or ".value" in name or "key" in name.split(".")[-1]) and P in t["shape"] else "fixed"
    kinds[kind] = kinds.get(kind, 0) + t["bytes"]
print("tensors", len(table), "| MB", round(offset / 2**20, 1), {k: round(v / 2**20, 1) for k, v in kinds.items()})
print("example", list(table.items())[:3])
