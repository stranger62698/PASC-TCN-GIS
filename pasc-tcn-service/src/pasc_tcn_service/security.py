"""HMAC integrity and service-to-service authorization for Phase D."""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import os
from typing import Any, Mapping

from .errors import MESSAGES, ServiceError

ARTIFACT_VERSION = "pasc-preprocessed-v1"
MIN_SECRET_LENGTH = 32


def _secret(name: str, *, required: bool) -> bytes | None:
    value = os.environ.get(name, "")
    if not value:
        if required:
            raise ServiceError(
                "PASC_SERVICE_NOT_CONFIGURED",
                MESSAGES["PASC_SERVICE_NOT_CONFIGURED"],
                status=503,
            )
        return None
    encoded = value.encode("utf-8")
    if len(encoded) < MIN_SECRET_LENGTH:
        raise ServiceError(
            "PASC_SERVICE_NOT_CONFIGURED",
            MESSAGES["PASC_SERVICE_NOT_CONFIGURED"],
            status=503,
            details={"setting": name, "minimumBytes": MIN_SECRET_LENGTH},
        )
    return encoded


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def seal_preprocessed(value: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(value)
    result.pop("integrity", None)
    key = _secret("PASC_ARTIFACT_SIGNING_KEY", required=False)
    payload = canonical_bytes(result)
    digest = hashlib.sha256(payload).hexdigest()
    integrity = {
        "artifactVersion": ARTIFACT_VERSION,
        "algorithm": "HMAC-SHA256",
        "payloadSha256": digest,
        "signed": key is not None,
    }
    if key is not None:
        integrity["signature"] = hmac.new(key, payload, hashlib.sha256).hexdigest()
    result["integrity"] = integrity
    return result


def verify_preprocessed(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ServiceError(
            "PASC_PREPROCESSED_ARTIFACT_INVALID",
            MESSAGES["PASC_PREPROCESSED_ARTIFACT_INVALID"],
        )
    integrity = value.get("integrity")
    if not isinstance(integrity, dict) or not integrity.get("signed"):
        raise ServiceError(
            "PASC_PREPROCESSED_ARTIFACT_INVALID",
            MESSAGES["PASC_PREPROCESSED_ARTIFACT_INVALID"],
        )
    if integrity.get("artifactVersion") != ARTIFACT_VERSION:
        raise ServiceError(
            "PASC_PREPROCESSED_ARTIFACT_INVALID",
            MESSAGES["PASC_PREPROCESSED_ARTIFACT_INVALID"],
        )
    payload_value = copy.deepcopy(value)
    payload_value.pop("integrity", None)
    payload = canonical_bytes(payload_value)
    digest = hashlib.sha256(payload).hexdigest()
    signature = hmac.new(
        _secret("PASC_ARTIFACT_SIGNING_KEY", required=True),
        payload,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(str(integrity.get("payloadSha256", "")), digest):
        raise ServiceError(
            "PASC_PREPROCESSED_ARTIFACT_INVALID",
            MESSAGES["PASC_PREPROCESSED_ARTIFACT_INVALID"],
        )
    if not hmac.compare_digest(str(integrity.get("signature", "")), signature):
        raise ServiceError(
            "PASC_PREPROCESSED_ARTIFACT_INVALID",
            MESSAGES["PASC_PREPROCESSED_ARTIFACT_INVALID"],
        )
    return payload_value


def authorize_inference(headers: Mapping[str, str] | None) -> None:
    normalized = {str(key).lower(): str(value) for key, value in (headers or {}).items()}
    authorization = normalized.get("authorization", "")
    candidate = ""
    if authorization.lower().startswith("bearer "):
        candidate = authorization[7:].strip()
    if not candidate:
        candidate = normalized.get("x-pasc-service-key", "")
    expected = _secret("PASC_SERVICE_API_KEY", required=True).decode("utf-8")
    if not candidate or not hmac.compare_digest(candidate, expected):
        raise ServiceError(
            "PASC_AUTHORIZATION_FAILED",
            MESSAGES["PASC_AUTHORIZATION_FAILED"],
            status=401,
        )
