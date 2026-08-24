"""Versioned JSON HTTP/ASGI API through the Phase D inference boundary."""

from __future__ import annotations

import json
import os
from typing import Any, Mapping

from .contract import (
    CONTRACT_VERSION,
    FEATURE_NAMES,
    MAX_SYNC_INFER_POINTS,
    MIN_EXPERIMENTAL_EPOCHS,
    MODEL_VERSION,
    SERVICE_VERSION,
    TARGET_EPOCHS,
)
from .errors import MESSAGES, ServiceError
from .inference import get_runtime, infer_payload, runtime_status
from .preprocessing import SCALER, preprocess_payload
from .schema import validate_payload
from .security import authorize_inference

MAX_BODY_BYTES = 32 * 1024 * 1024
KNOWN_PATHS = {
    "/v1/models",
    "/v1/validate",
    "/v1/preprocess",
    "/v1/infer",
}


def model_catalog() -> dict[str, Any]:
    runtime = runtime_status(load=False)
    return {
        "contractVersion": CONTRACT_VERSION,
        "serviceVersion": SERVICE_VERSION,
        "models": [
            {
                "modelVersion": MODEL_VERSION,
                "targetEpochs": TARGET_EPOCHS,
                "minimumExperimentalEpochs": MIN_EXPERIMENTAL_EPOCHS,
                "featureOrder": list(FEATURE_NAMES),
                "scalerArtifactVersion": SCALER["artifactVersion"],
                "preprocessingAvailable": True,
                "inferenceAvailable": runtime["inferenceAvailable"],
                "phase": "D",
                "maximumSynchronousInferencePoints": MAX_SYNC_INFER_POINTS,
                "inferenceRequirements": {
                    "authorization": "service_bearer_or_x_pasc_service_key",
                    "preprocessedArtifact": "signed_pasc_preprocessed_v1",
                },
                "runtime": runtime,
            }
        ],
    }


def _decode_json(raw_body: bytes) -> Any:
    if len(raw_body) > MAX_BODY_BYTES:
        raise ServiceError(
            "PASC_BAD_REQUEST",
            "请求体超过32 MiB限制。",
            status=413,
        )
    try:
        return json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ServiceError(
            "PASC_BAD_REQUEST",
            "请求体必须是UTF-8 JSON。",
            details={"reason": str(error)},
        ) from error


def dispatch(
    method: str,
    path: str,
    raw_body: bytes = b"",
    headers: Mapping[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    try:
        if method == "GET" and path == "/v1/models":
            return 200, model_catalog()
        if method == "POST" and path in {
            "/v1/validate",
            "/v1/preprocess",
            "/v1/infer",
        }:
            if path == "/v1/infer":
                authorize_inference(headers)
            payload = _decode_json(raw_body)
            if path == "/v1/validate":
                return 200, validate_payload(payload)
            if path == "/v1/preprocess":
                return 200, preprocess_payload(payload)
            return 200, infer_payload(payload)
        if path in KNOWN_PATHS:
            raise ServiceError(
                "PASC_METHOD_NOT_ALLOWED",
                "该接口不支持此HTTP方法。",
                status=405,
            )
        raise ServiceError(
            "PASC_NOT_FOUND",
            MESSAGES["PASC_NOT_FOUND"],
            status=404,
        )
    except ServiceError as error:
        return error.status, error.as_dict(CONTRACT_VERSION)
    except Exception:
        code = (
            "PASC_INFERENCE_FAILED"
            if path == "/v1/infer"
            else "PASC_PREPROCESS_FAILED"
        )
        error = ServiceError(
            code,
            MESSAGES[code],
            status=500,
        )
        return error.status, error.as_dict(CONTRACT_VERSION)


async def application(scope, receive, send):
    """Minimal ASGI 3 application."""
    if scope["type"] == "lifespan":
        while True:
            event = await receive()
            if event["type"] == "lifespan.startup":
                configured = bool(
                    os.environ.get("PASC_MODEL_BUNDLE_DIR", "").strip()
                )
                required = os.environ.get(
                    "PASC_REQUIRE_INFERENCE", "0"
                ).strip().lower() in {
                    "1", "true", "yes", "on"
                }
                try:
                    if configured or required:
                        get_runtime()
                except ServiceError as error:
                    await send(
                        {
                            "type": "lifespan.startup.failed",
                            "message": error.code,
                        }
                    )
                    return
                await send({"type": "lifespan.startup.complete"})
            elif event["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    if scope["type"] != "http":
        return
    body = bytearray()
    more_body = True
    while more_body:
        event = await receive()
        if event["type"] == "http.disconnect":
            return
        body.extend(event.get("body", b""))
        more_body = event.get("more_body", False)
        if len(body) > MAX_BODY_BYTES:
            break
    headers = {
        key.decode("latin-1").lower(): value.decode("latin-1")
        for key, value in scope.get("headers", [])
    }
    status, response = dispatch(
        scope["method"].upper(),
        scope.get("path", ""),
        bytes(body),
        headers,
    )
    encoded = json.dumps(
        response,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (
                    b"content-type",
                    b"application/json; charset=utf-8",
                ),
                (
                    b"content-length",
                    str(len(encoded)).encode("ascii"),
                ),
                (b"cache-control", b"no-store"),
            ],
        }
    )
    await send(
        {
            "type": "http.response.body",
            "body": encoded,
        }
    )
