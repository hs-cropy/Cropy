"""Serve the phone test page and the 2B browser bundle (model/ -> bundle dir) on 127.0.0.1 for a cloudflared tunnel."""
import http.server
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUNDLE = Path(sys.argv[1]).resolve()
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8777
BUNDLE08B = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else None


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".onnx": "application/octet-stream",
                      ".onnx_data": "application/octet-stream", ".json": "application/json", ".jinja": "text/plain"}

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        roots = {"/model/": BUNDLE, "/model2/": BUNDLE, "/model08b/": BUNDLE08B}  # model2 = fresh cache key
        prefix = next((p for p in roots if clean.startswith(p) and roots[p]), None)
        if prefix:
            root = roots[prefix]
            target = (root / clean[len(prefix):]).resolve()
            return str(target) if str(target).startswith(str(root)) else str(root / "__missing__")
        return str((HERE / clean.lstrip("/")).resolve())

    def end_headers(self):
        self.send_header("Cache-Control", "no-store" if self.path.endswith(".html") or self.path == "/" else "public, max-age=86400")
        super().end_headers()


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
