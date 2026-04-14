from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import unquote, urlparse

from personal_brain.api import ApiBadRequest, ApiNotFound, WorkbenchApiService
from personal_brain.config import BrainConfig


def handle_request(
    method: str,
    path: str,
    payload: dict | None = None,
    *,
    config: BrainConfig | None = None,
) -> tuple[int, dict]:
    service = WorkbenchApiService(config or BrainConfig.from_env())
    route = urlparse(path).path

    try:
        if method == "GET" and route in {"/health", "/api/health"}:
            return 200, {"status": "ok"}
        if method == "POST" and route in {"/ask", "/api/ask"}:
            return 200, service.ask(payload)
        if method == "GET" and route == "/api/memory/recent":
            return 200, service.recent_memory()
        if method == "GET" and route == "/api/writeback/proposals":
            return 200, service.list_writeback_proposals()
        if method == "GET" and route.startswith("/api/writeback/proposals/"):
            query_id = route.removeprefix("/api/writeback/proposals/")
            if query_id.endswith("/apply"):
                raise ApiNotFound(route)
            return 200, service.get_writeback_proposal(unquote(query_id))
        if method == "POST" and route.startswith("/api/writeback/proposals/") and route.endswith("/apply"):
            query_id = route.removeprefix("/api/writeback/proposals/").removesuffix("/apply").rstrip("/")
            return 200, service.apply_writeback(unquote(query_id))
        if method == "GET" and route == "/api/assets/ontology-candidates":
            return 200, service.list_ontology_candidates()
        if method == "GET" and route == "/api/assets/skill-candidates":
            return 200, service.list_skill_candidates()
        if method == "GET" and route == "/api/profile/method":
            return 200, service.get_method_profile()
        if method == "GET" and route == "/api/profile/persistent-memory":
            return 200, service.get_persistent_memory()
        if method == "GET" and route == "/api/profile/proposals":
            return 200, service.get_profile_proposals()
        if method == "GET" and route == "/api/eval/reports":
            return 200, service.list_eval_reports()
        if method == "GET" and route.startswith("/api/eval/reports/"):
            run_id = route.removeprefix("/api/eval/reports/")
            return 200, service.get_eval_report(unquote(run_id))
        if method == "GET" and route == "/api/wiki/tree":
            return 200, service.get_wiki_tree()
        if method == "GET" and route == "/api/wiki/pages":
            return 200, service.list_wiki_pages()
        if method == "GET" and route.startswith("/api/wiki/pages/"):
            identifier = route.removeprefix("/api/wiki/pages/")
            return 200, service.get_wiki_page(unquote(identifier))
    except ApiBadRequest as exc:
        return 400, {"error": str(exc)}
    except ApiNotFound as exc:
        return 404, {"error": str(exc)}
    except FileNotFoundError as exc:
        return 404, {"error": str(exc)}

    return 404, {"error": f"route not found: {route}"}


class BrainRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _dispatch(self, method: str) -> None:
        payload: dict | None = None
        if method == "POST":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length) if content_length else b"{}"
            payload = json.loads(raw or b"{}")
        status, body = handle_request(method, self.path, payload)
        self._send_json(status, body)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
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
