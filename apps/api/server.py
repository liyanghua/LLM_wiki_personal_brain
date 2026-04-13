from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer

from personal_brain.config import BrainConfig
from personal_brain.retrieval.query_engine import QueryEngine


class BrainRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.send_error(404)
            return
        self._send_json({"status": "ok"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/ask":
            self.send_error(404)
            return
        content_length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(content_length) or b"{}")
        question = payload.get("question", "")
        result = QueryEngine(BrainConfig.from_env()).ask(question)
        self._send_json(result.model_dump(mode="json"))

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _send_json(self, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = HTTPServer((host, port), BrainRequestHandler)
    print(f"Serving Personal Brain API on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    serve()
