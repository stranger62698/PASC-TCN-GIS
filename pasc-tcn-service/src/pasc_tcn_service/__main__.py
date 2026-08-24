"""Run the Phase D preprocessing and frozen inference API."""

from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .api import MAX_BODY_BYTES, dispatch
from .errors import ServiceError
from .inference import get_runtime


class Handler(BaseHTTPRequestHandler):
    server_version = "PascTcnPhaseD/0.3"

    def _handle(self):
        length = int(self.headers.get("content-length", "0"))
        if length > MAX_BODY_BYTES:
            raw = b" " * (MAX_BODY_BYTES + 1)
        else:
            raw = self.rfile.read(length) if length else b""
        headers = {
            key.lower(): value
            for key, value in self.headers.items()
        }
        status, payload = dispatch(
            self.command,
            self.path.split("?", 1)[0],
            raw,
            headers,
        )
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        self.send_response(status)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8",
        )
        self.send_header(
            "Content-Length",
            str(len(encoded)),
        )
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_DELETE = _handle

    def log_message(self, format, *args):
        return


def _truthy(value: str) -> bool:
    return value.strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def main():
    parser = argparse.ArgumentParser(
        description="PASC-TCN Phase D frozen inference API"
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8100)
    args = parser.parse_args()

    require_inference = _truthy(
        os.environ.get("PASC_REQUIRE_INFERENCE", "0")
    )
    bundle_configured = bool(
        os.environ.get("PASC_MODEL_BUNDLE_DIR", "").strip()
    )
    if require_inference or bundle_configured:
        try:
            runtime = get_runtime()
        except ServiceError as error:
            raise SystemExit(
                f"Phase D startup refused: {error.code}"
            ) from error
        print(
            "PASC-TCN Phase D model verified: "
            f"{runtime.manifest['buildHash']}"
        )
    elif require_inference:
        raise SystemExit(
            "Phase D startup refused: "
            "PASC_MODEL_UNAVAILABLE"
        )

    server = ThreadingHTTPServer(
        (args.host, args.port),
        Handler,
    )
    print(
        f"PASC-TCN Phase D service: "
        f"http://{args.host}:{args.port}"
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
