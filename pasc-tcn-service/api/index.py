"""Vercel adapter for the private, hash-verified PASC-TCN service."""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from pasc_tcn_service.api import MAX_BODY_BYTES, dispatch  # noqa: E402
from pasc_tcn_service.errors import ServiceError  # noqa: E402
from pasc_tcn_service.inference import get_runtime  # noqa: E402


def _truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


if _truthy(os.environ.get("PASC_REQUIRE_INFERENCE", "0")):
    try:
        get_runtime()
    except ServiceError as error:
        raise RuntimeError(f"PASC private function startup refused: {error.code}") from error


class handler(BaseHTTPRequestHandler):
    server_version = "PascTcnPrivateVercel/0.4"

    def _handle(self):
        length = int(self.headers.get("content-length", "0"))
        raw = b" " * (MAX_BODY_BYTES + 1) if length > MAX_BODY_BYTES else (self.rfile.read(length) if length else b"")
        path = self.path.split("?", 1)[0]
        if path == "/health":
            status, catalog = dispatch("GET", "/v1/models")
            model = (catalog.get("models") or [{}])[0] if status == 200 else {}
            payload = {
                "status": "ok" if status == 200 and model.get("inferenceAvailable") else "unavailable",
                "serviceVersion": catalog.get("serviceVersion"),
                "modelVersion": model.get("modelVersion"),
                "inferenceAvailable": bool(model.get("inferenceAvailable")),
                "runtime": model.get("runtime", {}),
            }
            status = 200 if payload["inferenceAvailable"] else 503
        else:
            status, payload = dispatch(
                self.command,
                path,
                raw,
                {key.lower(): value for key, value in self.headers.items()},
            )
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_DELETE = _handle

    def log_message(self, format, *args):
        return