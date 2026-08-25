"""CSV/record schema discovery, date parsing, confirmations, and compatibility."""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass
from datetime import date
from statistics import median
from typing import Any

from .contract import (
    CONTRACT_VERSION,
    DISPLACEMENT_FACTORS_TO_MM,
    FIELD_ALIASES,
    MIN_EXPERIMENTAL_EPOCHS,
    PREPROCESSING_STATES,
    REQUIRED_FIELDS,
    SIGN_FACTORS_TO_MODEL_NATIVE,
    TARGET_EPOCHS,
    VELOCITY_FACTORS_TO_MM_PER_YEAR,
)
from .errors import MESSAGES, ServiceError

_DATE_RE = re.compile(
    r"^(?:D)?(?P<year>\d{4})(?:[-_/]?)(?P<month>\d{2})(?:[-_/]?)(?P<day>\d{2})$",
    re.IGNORECASE,
)
_DATE_LIKE_RE = re.compile(r"^(?:D)?\d{4}", re.IGNORECASE)


@dataclass(frozen=True)
class DateColumn:
    source: str
    canonical: str
    value: date


@dataclass
class ValidatedDataset:
    headers: list[str]
    rows: list[dict[str, Any]]
    mapping: dict[str, str | None]
    mapping_report: dict[str, dict[str, Any]]
    date_groups: list[list[DateColumn]]
    settings: dict[str, Any]
    issues: list[dict[str, Any]]
    point_reports: list[dict[str, Any]]
    report: dict[str, Any]


def _issue(code: str, message: str | None = None, *, severity="error", **details):
    return {
        "severity": severity,
        "code": code,
        "message": message or MESSAGES.get(code, code),
        "details": details,
    }


def parse_date_field(field: str) -> tuple[str, date] | None:
    text = str(field).strip()
    match = _DATE_RE.fullmatch(text)
    if not match:
        return None
    try:
        parsed = date(
            int(match.group("year")),
            int(match.group("month")),
            int(match.group("day")),
        )
    except ValueError:
        return None
    return parsed.isoformat(), parsed


def _headers_and_rows(payload: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
    if isinstance(payload.get("csvText"), str):
        reader = csv.DictReader(io.StringIO(payload["csvText"].lstrip("\ufeff")))
        if not reader.fieldnames:
            raise ServiceError("PASC_BAD_REQUEST", "CSV缺少表头。")
        headers = [str(item).lstrip("\ufeff").strip() for item in reader.fieldnames]
        rows = []
        for source in reader:
            rows.append(
                {
                    headers[index]: source.get(reader.fieldnames[index])
                    for index in range(len(headers))
                }
            )
        return headers, rows

    records = payload.get("records")
    if isinstance(records, list) and all(isinstance(item, dict) for item in records):
        headers: list[str] = []
        seen: set[str] = set()
        for row in records:
            for key in row:
                field = str(key).lstrip("\ufeff").strip()
                if field not in seen:
                    seen.add(field)
                    headers.append(field)
        return headers, [{str(key).strip(): value for key, value in row.items()} for row in records]

    raise ServiceError("PASC_BAD_REQUEST", "请求必须包含csvText或records数组。")


def _heuristic_candidates(headers: list[str], semantic: str) -> list[str]:
    patterns = {
        "pointId": ("point", "fid", "pid", "编号", "点号"),
        "longitude": ("longitude", "lon", "经度", "xcoord"),
        "latitude": ("latitude", "lat", "纬度", "ycoord"),
        "velocity": ("velocity", "速率", "速度"),
        "coherence": ("coherence", "相干", "correlation"),
    }[semantic]
    return [
        header
        for header in headers
        if any(token in header.casefold() for token in patterns)
    ]


def _resolve_field(
    headers: list[str],
    semantic: str,
    explicit: Any,
) -> tuple[str | None, dict[str, Any]]:
    aliases = FIELD_ALIASES[semantic]
    if explicit not in (None, ""):
        requested = str(explicit)
        exact = [header for header in headers if header == requested]
        folded = [header for header in headers if header.casefold() == requested.casefold()]
        candidate = exact or folded
        if len(candidate) == 1:
            method = "exact_alias" if candidate[0] in aliases else "case_insensitive_alias"
            return candidate[0], {
                "source": candidate[0],
                "method": method,
                "candidates": candidate,
                "confirmedByUser": True,
            }
        return None, {
            "source": None,
            "method": "unresolved",
            "candidates": candidate,
            "confirmedByUser": True,
        }

    exact = [header for header in headers if header in aliases]
    if len(exact) == 1:
        return exact[0], {
            "source": exact[0],
            "method": "exact_alias",
            "candidates": exact,
            "confirmedByUser": False,
        }
    if len(exact) > 1:
        return None, {
            "source": None,
            "method": "unresolved",
            "candidates": exact,
            "confirmedByUser": False,
        }

    folded_aliases = {alias.casefold() for alias in aliases}
    folded = [header for header in headers if header.casefold() in folded_aliases]
    if len(folded) == 1:
        return folded[0], {
            "source": folded[0],
            "method": "case_insensitive_alias",
            "candidates": folded,
            "confirmedByUser": False,
        }
    if len(folded) > 1:
        return None, {
            "source": None,
            "method": "unresolved",
            "candidates": folded,
            "confirmedByUser": False,
        }

    heuristic = _heuristic_candidates(headers, semantic)
    if len(heuristic) == 1:
        return heuristic[0], {
            "source": heuristic[0],
            "method": "heuristic",
            "candidates": heuristic,
            "confirmedByUser": False,
        }
    return None, {
        "source": None,
        "method": "unresolved",
        "candidates": heuristic,
        "confirmedByUser": False,
    }


def _finite(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _duplicate_conflicts(rows: list[dict[str, Any]], group: list[DateColumn]) -> list[int]:
    conflicts: list[int] = []
    for index, row in enumerate(rows):
        values = [_finite(row.get(column.source)) for column in group]
        finite = [value for value in values if value is not None]
        if finite and any(not math.isclose(value, finite[0], rel_tol=1e-7, abs_tol=1e-7) for value in finite[1:]):
            conflicts.append(index)
    return conflicts


def _point_status(effective: int, total_dates: int, effective_dates) -> str:
    if effective < MIN_EXPERIMENTAL_EPOCHS:
        return "unsupported"
    gaps = [(right - left).days for left, right in zip(effective_dates, effective_dates[1:])]
    median_gap_days = float(median(gaps)) if gaps else 0.0
    if (
        effective == TARGET_EPOCHS
        and total_dates == TARGET_EPOCHS
        and 9.0 <= median_gap_days <= 15.0
    ):
        return "native_248"
    return "adapted_experimental"


def _level(errors: set[str], point_reports: list[dict[str, Any]]) -> int:
    schema_errors = {"PASC_CONTRACT_VERSION_UNSUPPORTED", "PASC_SCHEMA_UNRESOLVED", "PASC_DATE_PARSE_FAILED", "PASC_DUPLICATE_DATE_CONFLICT"}
    if errors & schema_errors:
        return 0
    if errors & {"PASC_UNIT_CONFIRMATION_REQUIRED", "PASC_SIGN_CONFIRMATION_REQUIRED"}:
        return 1
    if not point_reports or all(item["status"] == "unsupported" for item in point_reports):
        return 2
    if errors & {"PASC_PREPROCESSING_STATE_REQUIRED"}:
        return 2
    return 3


def inspect_payload(payload: dict[str, Any]) -> ValidatedDataset:
    if not isinstance(payload, dict):
        raise ServiceError("PASC_BAD_REQUEST", MESSAGES["PASC_BAD_REQUEST"])
    requested_contract = payload.get("contractVersion")
    contract_issue = (
        _issue(
            "PASC_CONTRACT_VERSION_UNSUPPORTED",
            requested=str(requested_contract),
            supported=CONTRACT_VERSION,
        )
        if requested_contract not in (None, CONTRACT_VERSION) else None
    )

    headers, rows = _headers_and_rows(payload)
    requested_mapping = payload.get("mapping") if isinstance(payload.get("mapping"), dict) else {}
    mapping: dict[str, str | None] = {}
    mapping_report: dict[str, dict[str, Any]] = {}
    issues: list[dict[str, Any]] = [contract_issue] if contract_issue else []

    for semantic in FIELD_ALIASES:
        field, detail = _resolve_field(headers, semantic, requested_mapping.get(semantic))
        mapping[semantic] = field
        mapping_report[semantic] = detail
        if field is None and (semantic in REQUIRED_FIELDS or detail["candidates"]):
            issues.append(_issue("PASC_SCHEMA_UNRESOLVED", semantic=semantic, candidates=detail["candidates"]))
        elif detail["method"] == "heuristic" and not detail["confirmedByUser"]:
            issues.append(
                _issue(
                    "PASC_SCHEMA_UNRESOLVED",
                    "启发式字段映射必须由用户确认。",
                    semantic=semantic,
                    candidates=detail["candidates"],
                )
            )

    requested_dates = requested_mapping.get("dateColumns")
    date_headers = (
        [str(item) for item in requested_dates]
        if isinstance(requested_dates, list) and requested_dates
        else headers
    )
    selected_dates_explicitly = isinstance(requested_dates, list) and bool(requested_dates)
    missing_date_headers = (
        [header for header in date_headers if header not in headers]
        if selected_dates_explicitly else []
    )
    if missing_date_headers:
        issues.append(
            _issue("PASC_DATE_PARSE_FAILED", "选择的日期字段不存在。", fields=missing_date_headers)
        )
        date_headers = [header for header in date_headers if header in headers]
    parsed_dates: list[DateColumn] = []
    invalid_date_like: list[str] = []
    for header in date_headers:
        parsed = parse_date_field(header)
        if parsed:
            parsed_dates.append(DateColumn(header, parsed[0], parsed[1]))
        elif _DATE_LIKE_RE.match(header):
            invalid_date_like.append(header)

    if invalid_date_like:
        issues.append(_issue("PASC_DATE_PARSE_FAILED", fields=invalid_date_like))
    if not parsed_dates:
        issues.append(_issue("PASC_DATE_PARSE_FAILED"))

    grouped: dict[str, list[DateColumn]] = {}
    for column in parsed_dates:
        grouped.setdefault(column.canonical, []).append(column)
    date_groups = sorted(grouped.values(), key=lambda group: group[0].value)

    duplicate_dates: list[dict[str, Any]] = []
    for group in date_groups:
        if len(group) <= 1:
            continue
        conflicts = _duplicate_conflicts(rows, group)
        duplicate_dates.append(
            {
                "date": group[0].canonical,
                "fields": [item.source for item in group],
                "conflictRows": conflicts,
            }
        )
        if conflicts:
            issues.append(
                _issue(
                    "PASC_DUPLICATE_DATE_CONFLICT",
                    date=group[0].canonical,
                    fields=[item.source for item in group],
                    conflictRows=conflicts,
                )
            )
        else:
            issues.append(
                _issue(
                    "PASC_DUPLICATE_DATE_IDENTICAL",
                    "重复日期数值一致或互补，将合并为一个时相。",
                    severity="warning",
                    date=group[0].canonical,
                    fields=[item.source for item in group],
                )
            )

    settings_input = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    displacement_unit = str(settings_input.get("displacementUnit", "")).strip().casefold()
    velocity_unit = str(settings_input.get("velocityUnit", "")).strip().casefold()
    sign = str(settings_input.get("signConvention", "")).strip()
    state = str(settings_input.get("preprocessingState", "unknown")).strip()

    if displacement_unit not in DISPLACEMENT_FACTORS_TO_MM:
        issues.append(_issue("PASC_UNIT_CONFIRMATION_REQUIRED", unit="displacement"))
    if mapping.get("velocity") and velocity_unit not in VELOCITY_FACTORS_TO_MM_PER_YEAR:
        issues.append(_issue("PASC_UNIT_CONFIRMATION_REQUIRED", unit="velocity"))
    if sign not in SIGN_FACTORS_TO_MODEL_NATIVE:
        issues.append(_issue("PASC_SIGN_CONFIRMATION_REQUIRED"))
    if state not in PREPROCESSING_STATES or state == "unknown":
        issues.append(_issue("PASC_PREPROCESSING_STATE_REQUIRED"))

    settings = {
        "displacementUnit": displacement_unit or None,
        "velocityUnit": velocity_unit or None,
        "signConvention": sign or None,
        "preprocessingState": state,
        "internalDisplacementUnit": "mm",
        "internalVelocityUnit": "mm/year",
        "internalCrs": "EPSG:4326",
    }

    point_reports: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        effective_dates = []
        for group in date_groups:
            if any(_finite(row.get(column.source)) is not None for column in group):
                effective_dates.append(group[0].value)
        effective = len(effective_dates)
        point_id_field = mapping.get("pointId")
        point_id = row.get(point_id_field) if point_id_field else index
        status = _point_status(effective, len(date_groups), effective_dates)
        report = {
            "row": index,
            "pointId": str(point_id),
            "effectiveEpochs": effective,
            "status": status,
            "supported": status != "unsupported",
        }
        if status == "unsupported":
            report["reason"] = {
                "code": "PASC_TOO_FEW_VALID_EPOCHS",
                "message": MESSAGES["PASC_TOO_FEW_VALID_EPOCHS"],
            }
        point_reports.append(report)

    if not rows:
        issues.append(_issue("PASC_BAD_REQUEST", "数据集不包含数据行。"))

    for semantic in ("longitude", "latitude"):
        field = mapping.get(semantic)
        if field:
            invalid = [index for index, row in enumerate(rows) if _finite(row.get(field)) is None]
            if invalid:
                issues.append(
                    _issue(
                        "PASC_SCHEMA_UNRESOLVED",
                        f"{semantic}包含非有限数值。",
                        semantic=semantic,
                        invalidRows=invalid,
                    )
                )

    error_codes = {item["code"] for item in issues if item["severity"] == "error"}
    counts = {
        "native248": sum(item["status"] == "native_248" for item in point_reports),
        "experimental": sum(item["status"] == "adapted_experimental" for item in point_reports),
        "unsupported": sum(item["status"] == "unsupported" for item in point_reports),
    }
    report = {
        "contractVersion": CONTRACT_VERSION,
        "valid": not error_codes,
        "capabilityLevel": _level(error_codes, point_reports),
        "mapping": mapping_report,
        "dates": {
            "count": len(date_groups),
            "canonical": [group[0].canonical for group in date_groups],
            "duplicates": duplicate_dates,
            "parseFailures": invalid_date_like,
            "missingSelected": missing_date_headers,
        },
        "settings": settings,
        "compatibility": {
            "targetEpochs": TARGET_EPOCHS,
            "minimumExperimentalEpochs": MIN_EXPERIMENTAL_EPOCHS,
            "counts": counts,
            "points": point_reports,
        },
        "issues": issues,
    }

    return ValidatedDataset(
        headers=headers,
        rows=rows,
        mapping=mapping,
        mapping_report=mapping_report,
        date_groups=date_groups,
        settings=settings,
        issues=issues,
        point_reports=point_reports,
        report=report,
    )


def validate_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a non-mutating validation report; validation failures stay in the body."""
    return inspect_payload(payload).report
