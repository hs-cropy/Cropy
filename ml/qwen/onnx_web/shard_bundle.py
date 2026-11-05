"""Split a bundle's big external-data files into ~256 MB shards for phones (transformers.js use_external_data_format).

iPhone Safari killed the tab right after the 1.09 GB decoder file finished downloading: transformers.js holds a whole
file in memory and copies it into the browser cache, so one huge file means one huge peak. Shards keep each peak small.

Shard names follow transformers.js: <file>.onnx_data, <file>.onnx_data_1, ... and config.json gets
"transformers.js_config.use_external_data_format[<file>.onnx] = <number of shards>". Weights are unchanged byte for byte.
"""
import argparse
import json
from pathlib import Path

import onnx
from onnx.external_data_helper import set_external_data

ap = argparse.ArgumentParser()
ap.add_argument("--bundle", required=True)
ap.add_argument("--graphs", default="decoder_model_merged_q4f16.onnx")
ap.add_argument("--shard-mb", type=int, default=256)
args = ap.parse_args()

bundle = Path(args.bundle)
cfg_path = bundle / "config.json"
cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
limit = args.shard_mb * 2**20

for name in args.graphs.split(","):
    path = bundle / "onnx" / name
    model = onnx.load(str(path), load_external_data=True)
    for old in (bundle / "onnx").glob(name + "_data*"):
        old.unlink()
    shard, offset, handles = 0, 0, {}

    def handle(i):
        if i not in handles:
            fname = f"{name}_data" + ("" if i == 0 else f"_{i}")
            handles[i] = (fname, open(bundle / "onnx" / fname, "wb"))
        return handles[i]

    for t in model.graph.initializer:
        raw = t.raw_data
        if len(raw) < 1024:  # keep small constants inline, like the official export
            continue
        if offset and offset + len(raw) > limit:
            shard, offset = shard + 1, 0
        fname, f = handle(shard)
        pad = (-offset) % 4096  # aligned offsets, as onnx does
        if pad:
            f.write(b"\0" * pad)
            offset += pad
        f.write(raw)
        set_external_data(t, location=fname, offset=offset, length=len(raw))
        t.ClearField("raw_data")
        t.data_location = onnx.TensorProto.EXTERNAL
        offset += len(raw)
    for _, f in handles.values():
        f.close()
    onnx.save_model(model, str(path))
    n = len(handles)
    cfg.setdefault("transformers.js_config", {}).setdefault("use_external_data_format", {})[name] = n
    sizes = [round((bundle / "onnx" / fn).stat().st_size / 2**20, 1) for fn, _ in handles.values()]
    print(name, "shards", n, "MB", sizes)

cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
print("config", cfg["transformers.js_config"]["use_external_data_format"])
