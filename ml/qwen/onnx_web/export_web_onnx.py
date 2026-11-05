"""Build the browser (transformers.js, WebGPU) bundle of a fine-tuned Cropy Qwen3.5 model.

Takes the official onnx-community graphs (same architecture), learns how each ONNX weight is derived from the
BASE checkpoint (weights.learn_* below, every tensor checked against the official file), then writes the same
graphs with our weights. Nothing about the graph changes, so transformers.js loads it like the official model.

Output (--out-dir), the folder the offline web app downloads:
  onnx/decoder_model_merged_<dtype>.onnx(+_data)   onnx/embed_tokens_<dtype>.onnx(+_data)
  config.json  generation_config.json  chat_template.jinja  tokenizer.json  tokenizer_config.json  cropy_prompt.json
  export_report.json   mapping checks, sizes and sha256 of every file
"""
import argparse
import collections
import hashlib
import json
import re
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import onnx
from onnx import numpy_helper

sys.path.insert(0, str(Path(__file__).resolve().parent))
import weights as W  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--ref-repo", required=True, help="onnx-community/Qwen3.5-2B-ONNX-OPT")
ap.add_argument("--ref-rev", required=True)
ap.add_argument("--base-repo", required=True, help="Qwen/Qwen3.5-2B (what the official ONNX was built from)")
ap.add_argument("--base-rev", required=True)
ap.add_argument("--model-dir", required=True, help="our merged HF model (safetensors + tokenizer + cropy_prompt.json)")
ap.add_argument("--out-dir", required=True)
ap.add_argument("--dtypes", default="q4f16,q4")
ap.add_argument("--cache-dir", default="/content/hf_cache")
args = ap.parse_args()

import torch  # noqa: E402
from huggingface_hub import snapshot_download  # noqa: E402
from safetensors import safe_open  # noqa: E402

out = Path(args.out_dir)
(out / "onnx").mkdir(parents=True, exist_ok=True)
dtypes = [d.strip() for d in args.dtypes.split(",") if d.strip()]
report = dict(ref=[args.ref_repo, args.ref_rev], base=[args.base_repo, args.base_rev], model_dir=args.model_dir,
              dtypes=dtypes, graphs={})

patterns = ["config.json", "generation_config.json", "chat_template.jinja"]
for d in dtypes:
    patterns += [f"onnx/decoder_model_merged_{d}.onnx*", f"onnx/embed_tokens_{d}.onnx*"]
ref_dir = Path(snapshot_download(args.ref_repo, revision=args.ref_rev, allow_patterns=patterns, cache_dir=args.cache_dir))
base_dir = Path(snapshot_download(args.base_repo, revision=args.base_rev, allow_patterns=["*.safetensors", "*.json"],
                                  cache_dir=args.cache_dir))
print("공식 ONNX", ref_dir, "| 기본 모델", base_dir)


class Checkpoint:
    """Lazy float32 access to a HF safetensors checkpoint by canonical key."""

    def __init__(self, folder):
        self.files, self.keys = [], {}
        for path in sorted(Path(folder).glob("*.safetensors")):
            f = safe_open(str(path), framework="pt")
            self.files.append(f)
            for k in f.keys():
                c = W.canonical(k)
                if c:
                    self.keys[c] = (f, k)
        assert self.keys, f"safetensors가 없습니다: {folder}"

    def get(self, key):
        f, k = self.keys[key]
        return f.get_tensor(k).float().numpy()


base, ours = Checkpoint(base_dir), Checkpoint(args.model_dir)
cfg = json.loads((base_dir / "config.json").read_text())
text_cfg = cfg.get("text_config", cfg)
config = dict(num_attention_heads=text_cfg["num_attention_heads"], head_dim=text_cfg["head_dim"])
missing = sorted(set(base.keys) - set(ours.keys) - {"lm_head.weight"})
assert not missing, f"우리 모델에 없는 가중치: {missing[:5]}"


def float_name(quant_base):
    """'model_layers_3_attn_q_proj_MatMul_weight' -> 'model.layers.3.attn.q_proj.MatMul.weight' (rule names)."""
    if quant_base == "lm_head_MatMul_weight":
        return "lm_head.MatMul.weight"
    if quant_base == "model_embed_tokens_weight":
        return "model.embed_tokens.weight"
    m = re.fullmatch(r"model_layers_(\d+)_(gdn|attn|mlp)_(.+)_MatMul_weight", quant_base)
    assert m, quant_base
    return f"model.layers.{m.group(1)}.{m.group(2)}.{m.group(3)}.MatMul.weight"


def rows_for(name, form, ckpt, key):
    x = W.apply(form, ckpt.get(key), config)
    return x if name == "model.embed_tokens.weight" else W.matmul_rows(x)  # Gather rows are already [V, K]


def fill_graph(src, dst):
    """Learn the mapping on this graph with the base weights, then write it with ours."""
    model = onnx.load(str(src), load_external_data=True)
    inits = {i.name: i for i in model.graph.initializer}
    arrays = {}
    checks = collections.Counter()
    worst = dict(quant_bytes=1.0, quant_zp=1.0)
    t0 = time.time()
    quant_bases = sorted(n[: -len("_quant")] for n in inits if n.endswith("_quant"))
    floats = [n for n in inits if not n.startswith("/model/constants") and n != "model.inv_freq"
              and not any(n.startswith(b + "_") for b in quant_bases)]
    for name in floats:  # norms, conv, A, dt_bias: exact match after casting to the stored dtype
        ref = numpy_helper.to_array(inits[name])
        hit = None
        for key, forms in W.candidates(name):
            if key not in base.keys:
                continue
            for form in forms:
                y = W.apply(form, base.get(key), config)
                if y.shape == ref.shape and np.allclose(y.astype(ref.dtype).astype(np.float32), ref.astype(np.float32), rtol=0, atol=1e-6):
                    hit = (key, form)
                    break
            if hit:
                break
        assert hit, f"{src.name}: {name}에 맞는 기본 가중치가 없습니다"
        arrays[name] = W.apply(hit[1], ours.get(hit[0]), config).astype(ref.dtype)
        checks[f"float:{hit[1]}"] += 1
    for qb in quant_bases:  # MatMulNBits / GatherBlockQuantized: our quantization of the base must reproduce the official blob
        name = float_name(qb)
        oq, osc, ozp = (numpy_helper.to_array(inits[qb + s]) for s in ("_quant", "_scales", "_zp"))
        hit = None
        for key, forms in W.candidates(name):
            if key not in base.keys:
                continue
            for form in forms:
                rows = rows_for(name, form, base, key)
                if rows.shape[0] != osc.shape[0] or rows.shape[1] != osc.shape[1] * W.BLOCK:
                    continue
                res = W.check_quant_layout(rows, oq, osc, ozp)
                if res["same_bytes"] >= 0.98 and res["same_zero_points"] >= 0.98:
                    hit = (key, form, res)
                    break
            if hit:
                break
        assert hit, f"{src.name}: {name}의 양자화 값이 기본 모델과 맞지 않습니다"
        worst["quant_bytes"] = min(worst["quant_bytes"], hit[2]["same_bytes"])
        worst["quant_zp"] = min(worst["quant_zp"], hit[2]["same_zero_points"])
        packed, scales, zp = W.quantize_blockwise(rows_for(name, hit[1], ours, hit[0]), W.BLOCK, osc.dtype)
        arrays[qb + "_quant"] = packed.reshape(oq.shape)
        arrays[qb + "_scales"] = scales.reshape(osc.shape)
        arrays[qb + "_zp"] = zp.reshape(ozp.shape)
        checks[f"quant:{hit[1]}"] += 1
    for name, arr in arrays.items():
        inits[name].CopyFrom(numpy_helper.from_array(np.ascontiguousarray(arr), name))
    for i in model.graph.initializer:  # drop stale external-data pointers before saving to the new file
        del i.external_data[:]
        i.data_location = onnx.TensorProto.DEFAULT
    onnx.save_model(model, str(dst), save_as_external_data=True, all_tensors_to_one_file=True,
                    location=dst.name + "_data", size_threshold=1024)
    info = dict(weights=len(arrays), transforms=dict(checks), **worst, seconds=round(time.time() - t0))
    print(dst.name, json.dumps(info, ensure_ascii=False))
    return info


for d in dtypes:
    for part in ("embed_tokens", "decoder_model_merged"):
        name = f"{part}_{d}.onnx"
        report["graphs"][name] = fill_graph(ref_dir / "onnx" / name, out / "onnx" / name)

for name in ("config.json", "generation_config.json", "chat_template.jinja"):
    shutil.copy(ref_dir / name, out / name)
model_dir = Path(args.model_dir)
for name in ("tokenizer.json", "tokenizer_config.json", "cropy_prompt.json"):
    shutil.copy(model_dir / name, out / name)
if (model_dir / "chat_template.jinja").exists():  # ours if saved, else the official one (same template)
    shutil.copy(model_dir / "chat_template.jinja", out / "chat_template.jinja")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 24), b""):
            h.update(chunk)
    return h.hexdigest()


report["files"] = {str(p.relative_to(out)).replace("\\", "/"): dict(bytes=p.stat().st_size, sha256=sha256(p))
                   for p in sorted(out.rglob("*")) if p.is_file() and p.name != "export_report.json"}
for d in dtypes:
    report[f"download_mb_{d}"] = round(sum(v["bytes"] for k, v in report["files"].items()
                                           if not k.startswith("onnx/") or f"_{d}.onnx" in k) / 2**20, 1)
(out / "export_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
print("완료", out, {k: v for k, v in report.items() if k.startswith("download_mb")})
