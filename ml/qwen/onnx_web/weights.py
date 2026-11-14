"""Put Cropy's fine-tuned Qwen3.5 weights into the official transformers.js ONNX graphs (onnx-community/Qwen3.5-*-ONNX-OPT).

Why not export: optimum does not export qwen3_5, and the official graphs use ONNX Runtime contrib ops
(LinearAttention, CausalConvWithState, GroupQueryAttention) that transformers.js / onnxruntime-web run on WebGPU.
Our model has the same architecture and vocabulary size (the 10 <hs_*> tokens took unused ids below 248,320),
so only the weight values differ. We keep the official graph and replace every weight.

How the mapping is trusted: learn_mapping() takes the BASE model (the one the official ONNX was built from),
tries the candidate transforms for each ONNX initializer and keeps the one that reproduces the official float32
value exactly. The same (key, transform) is then applied to our fine-tuned weights.

Quantized graphs (q4, q4f16) store MatMul weights as MatMulNBits (4 bit, block 32, asymmetric, zero points) and the
embedding as GatherBlockQuantized; quantize_blockwise() writes the same layout, check_quant_layout() compares it
with the official blobs of the base model.
"""
import re

import numpy as np

BLOCK = 32
PREFIXES = ("model.language_model.", "language_model.model.", "language_model.", "model.")


def canonical(hf_key):
    """HF key -> 'layers.3.self_attn.q_proj.weight' / 'embed_tokens.weight' / 'norm.weight' (None = not text)."""
    if hf_key.startswith(("mtp.", "model.visual.", "visual.", "model.vision")):
        return None
    if hf_key == "lm_head.weight":
        return hf_key
    for p in PREFIXES:
        if hf_key.startswith(p):
            return hf_key[len(p):]
    return hf_key


def bf16(x):
    """Round float32 to the nearest bfloat16 value (ties to even), kept as float32. The official export loaded the
    model in bf16, so float32 checkpoint tensors (e.g. linear_attn.norm.weight) appear bf16-rounded in the ONNX."""
    u = np.ascontiguousarray(x, np.float32).view(np.uint32)
    u = ((u + 0x7FFF + ((u >> 16) & 1)) & 0xFFFF0000).astype(np.uint32)
    return u.view(np.float32)


def _t(x):
    return np.ascontiguousarray(x.T)


def _q_gate_blocks(x, heads, head_dim):
    # HF q_proj rows are [head0 query, head0 gate, head1 query, ...]; a builder may regroup them as [all query | all gate].
    w = x.reshape(heads, 2, head_dim, -1).transpose(1, 0, 2, 3).reshape(2 * heads * head_dim, -1)
    return _t(w)


TRANSFORMS = {
    "id": lambda x, **_: x,
    "bf16": lambda x, **_: bf16(x),
    "T": lambda x, **_: _t(x),
    "plus1": lambda x, **_: x + 1.0,
    "negexp": lambda x, **_: -np.exp(x),
    "negexp_bf16": lambda x, **_: -np.exp(bf16(x)),
    "T_qgate": lambda x, heads, head_dim, **_: _q_gate_blocks(x, heads, head_dim),
}


def candidates(onnx_name):
    """ONNX initializer name -> [(canonical HF key, [transform names to try])]."""
    if onnx_name == "lm_head.MatMul.weight":
        return [("lm_head.weight", ["T"]), ("embed_tokens.weight", ["T"])]
    if onnx_name == "model.embed_tokens.weight":
        return [("embed_tokens.weight", ["id"])]
    m = re.fullmatch(r"model\.layers\.(\d+)\.(.+)", onnx_name)
    if not m:
        return []
    i, rest = m.groups()
    if rest == "final_norm_layernorm.weight":
        return [("norm.weight", ["id", "plus1"])]
    if rest.startswith("gdn."):
        rest = "linear_attn." + rest[len("gdn."):]
    elif rest.startswith("attn."):
        rest = "self_attn." + rest[len("attn."):]
    if rest.endswith(".MatMul.weight"):
        key = rest[: -len(".MatMul.weight")] + ".weight"
        forms = ["T", "T_qgate"] if key.endswith("q_proj.weight") else ["T"]
        return [(f"layers.{i}.{key}", forms)]
    if rest.endswith("A_neg_exp"):
        return [(f"layers.{i}.linear_attn.A_log", ["negexp", "negexp_bf16"])]
    if rest.endswith("conv1d.weight_3d"):
        return [(f"layers.{i}.linear_attn.conv1d.weight", ["id", "bf16"])]
    rest = rest.replace(".layernorm.weight", ".weight")
    return [(f"layers.{i}.{rest}", ["id", "plus1", "bf16"])]


def apply(transform, x, config):
    return TRANSFORMS[transform](x.astype(np.float32), heads=config["num_attention_heads"], head_dim=config["head_dim"])


def learn_mapping(names, ref_get, base_get, base_keys, config, atol=1e-6):
    """names: ONNX float initializers to fill. ref_get(name)/base_get(key) return float32 arrays.
    Returns {onnx name: (canonical key, transform)}; raises with the list of names that matched nothing."""
    mapping, failed = {}, []
    for name in names:
        ref = ref_get(name)
        hit = None
        for key, forms in candidates(name):
            if key not in base_keys:
                continue
            x = base_get(key)
            for form in forms:
                y = apply(form, x, config)
                if y.shape == ref.shape and np.allclose(y, ref, rtol=0, atol=atol):
                    hit = (key, form)
                    break
            if hit:
                break
        if hit:
            mapping[name] = hit
        else:
            failed.append(name)
    if failed:
        raise ValueError(f"{len(failed)} ONNX weights matched no base tensor: {failed[:10]}")
    return mapping


# ---- 4-bit blockwise quantization (ONNX Runtime MatMulNBits / GatherBlockQuantized layout) ----

def quantize_blockwise(w, block=BLOCK, scale_dtype=np.float32):
    """w: [rows, K] float32, quantized along K in blocks.
    Returns packed uint8 [rows, n_blocks, block // 2], scales float32 [rows, n_blocks], zero points uint8 [rows, ceil(n_blocks / 2)].
    Asymmetric with the range widened to include 0, like ONNX Runtime's blockwise quantizer."""
    rows, k = w.shape
    assert k % block == 0, (w.shape, block)
    nb = k // block
    x = w.reshape(rows, nb, block).astype(np.float32)
    vmin = np.minimum(x.min(axis=2), 0.0)
    vmax = np.maximum(x.max(axis=2), 0.0)
    scale = (vmax - vmin) / 15.0
    scale = np.where(scale == 0, 1.0, scale).astype(np.float32)  # q and zp use the float32 scale; q4f16 stores it as fp16
    zp = np.clip(np.round(-vmin / scale), 0, 15).astype(np.uint8)
    q = np.clip(np.round(x / scale[..., None]) + zp[..., None], 0, 15).astype(np.uint8)
    packed = (q[..., 0::2] | (q[..., 1::2] << 4)).astype(np.uint8)
    zpp = zp if nb % 2 == 0 else np.concatenate([zp, np.zeros((rows, 1), np.uint8)], axis=1)
    zp_packed = (zpp[:, 0::2] | (zpp[:, 1::2] << 4)).astype(np.uint8)
    return packed, scale.astype(scale_dtype), zp_packed


def dequantize_blockwise(packed, scales, zp_packed, block=BLOCK):
    rows, nb = scales.shape
    p = packed.reshape(rows, nb, block // 2)
    q = np.empty((rows, nb, block), np.float32)
    q[..., 0::2] = p & 0x0F
    q[..., 1::2] = p >> 4
    z = np.empty((rows, zp_packed.shape[1] * 2), np.float32)
    z[:, 0::2] = zp_packed & 0x0F
    z[:, 1::2] = zp_packed >> 4
    z = z[:, :nb]
    return ((q - z[..., None]) * scales.astype(np.float32)[..., None]).reshape(rows, nb * block)


def quant_inputs(onnx_name):
    """Base name of the quantized triple for an ONNX float weight: 'a.b.MatMul.weight' -> 'a_b_MatMul_weight'."""
    return onnx_name.replace(".", "_")


def matmul_rows(w_kn):
    """MatMul weight [K, N] -> MatMulNBits rows [N, K]."""
    return np.ascontiguousarray(w_kn.T)


def check_quant_layout(w_rows, official_packed, official_scales, official_zp, block=BLOCK):
    """Quantize base weights our way and compare with the official blobs. Returns agreement and dequantized error."""
    packed, scales, zp = quantize_blockwise(w_rows, block, official_scales.dtype)
    scales = scales.astype(np.float32)
    official_packed = official_packed.reshape(packed.shape)
    same_nibbles = float(np.mean(packed == official_packed))
    deq_ours = dequantize_blockwise(packed, scales, zp, block)
    deq_official = dequantize_blockwise(official_packed, official_scales.astype(np.float32).reshape(scales.shape),
                                        official_zp.reshape(zp.shape), block)
    return dict(same_bytes=round(same_nibbles, 4),
                same_zero_points=round(float(np.mean(zp == official_zp.reshape(zp.shape))), 4),
                scale_rel_diff=float(np.max(np.abs(scales - official_scales.astype(np.float32).reshape(scales.shape)) / np.maximum(scales, 1e-12))),
                ours_err=float(np.mean(np.abs(deq_ours - w_rows))), official_err=float(np.mean(np.abs(deq_official - w_rows))))


def quantize_chunked(w_rows, block=BLOCK, scale_dtype=np.float32, chunk=16384):
    """quantize_blockwise in row chunks so the 248,320-row embedding / lm_head fit in a few GB of RAM."""
    parts = [quantize_blockwise(w_rows[i:i + chunk], block, scale_dtype) for i in range(0, w_rows.shape[0], chunk)]
    return tuple(np.concatenate([p[k] for p in parts]) for k in range(3))


def check_quant_layout_chunked(w_rows, official_packed, official_scales, official_zp, block=BLOCK, chunk=16384):
    """check_quant_layout over row chunks; agreement rates are row-weighted means."""
    n = w_rows.shape[0]
    acc = dict(same_bytes=0.0, same_zero_points=0.0, scale_rel_diff=0.0, ours_err=0.0, official_err=0.0)
    for i in range(0, n, chunk):
        j = min(n, i + chunk)
        r = check_quant_layout(w_rows[i:j], official_packed[i:j], official_scales[i:j], official_zp[i:j], block)
        w = (j - i) / n
        for k in ("same_bytes", "same_zero_points", "ours_err", "official_err"):
            acc[k] += r[k] * w
        acc["scale_rel_diff"] = max(acc["scale_rel_diff"], r["scale_rel_diff"])
    acc["same_bytes"] = round(acc["same_bytes"], 4)
    acc["same_zero_points"] = round(acc["same_zero_points"], 4)
    return acc
