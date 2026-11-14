"""Serve the phone test page and the 2B browser bundle (model/ -> bundle dir) on 127.0.0.1 for a cloudflared tunnel."""
import http.server
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUNDLE = Path(sys.argv[1]).resolve()
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8777
BUNDLE08B = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else None
CLF = Path(sys.argv[4]).resolve() if len(sys.argv) > 4 else None   # classifier bundle: model_int8.onnx, tokenizer*, labels.json


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".onnx": "application/octet-stream",
                      ".onnx_data": "application/octet-stream", ".json": "application/json", ".jinja": "text/plain"}

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        roots = {"/model/": BUNDLE, "/model2/": BUNDLE, "/model08b/": BUNDLE08B, "/clf/": CLF}  # model2 = fresh cache key
        prefix = next((p for p in roots if clean.startswith(p) and roots[p]), None)
        if prefix:
            root = roots[prefix]
            target = (root / clean[len(prefix):]).resolve()
            return str(target) if str(target).startswith(str(root)) else str(root / "__missing__")
        return str((HERE / clean.lstrip("/")).resolve())

    def end_headers(self):
        # small files (page, config, lists) must always be fresh; only the big weight files are cacheable
        fresh = self.path == "/" or self.path.split("?", 1)[0].endswith((".html", ".json"))
        self.send_header("Cache-Control", "no-store" if fresh else "public, max-age=86400")
        # Cross-origin isolation lets onnxruntime-web use SharedArrayBuffer, i.e. multi-threaded wasm
        # (without it the CPU path ran single-threaded: 161 s per question on a 22-core PC).
        # Only for the CPU page (?cpu=1): isolation changes how the browser treats every other request, so the
        # WebGPU measurement stays on the plain page.
        if "cpu=1" in self.path:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
