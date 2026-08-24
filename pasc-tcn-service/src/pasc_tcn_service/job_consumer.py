"""Phase F durable large-data job consumer.

The consumer pulls only from one configured WebGIS origin, streams the source CSV,
runs the frozen preprocessing/inference boundary in bounded chunks, and writes
owner-isolated artifacts back through authenticated internal routes.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import heapq
import io
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, BinaryIO, Callable, Iterable, Protocol

from .contract import CONTRACT_VERSION
from .errors import ServiceError
from .inference import infer_payload
from .preprocessing import preprocess_payload

MAX_CHUNK_SIZE = 512
MAX_MAP_POINTS = 5000
MAP_LEVELS = (
    ("map_level_0", 500),
    ("map_level_1", 2000),
    ("map_level_2", 5000),
)


class ConsumerError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class JobCancelled(ConsumerError):
    def __init__(self):
        super().__init__(
            "PASC_JOB_CANCELLED",
            "任务已按用户请求取消。",
            retryable=False,
        )


@dataclass(frozen=True)
class ConsumerConfig:
    webgis_base_url: str
    api_key: str
    worker_id: str
    lease_seconds: int = 300
    poll_seconds: float = 5.0
    request_timeout_seconds: float = 60.0

    @classmethod
    def from_env(cls) -> "ConsumerConfig":
        return cls(
            webgis_base_url=os.environ.get(
                "PASC_WEBGIS_BASE_URL", ""
            ).strip(),
            api_key=os.environ.get(
                "PASC_CONSUMER_API_KEY", ""
            ).strip(),
            worker_id=os.environ.get(
                "PASC_CONSUMER_WORKER_ID",
                socket.gethostname() or "python-consumer",
            ).strip(),
            lease_seconds=int(
                os.environ.get("PASC_CONSUMER_LEASE_SECONDS", "300")
            ),
            poll_seconds=float(
                os.environ.get("PASC_CONSUMER_POLL_SECONDS", "5")
            ),
            request_timeout_seconds=float(
                os.environ.get("PASC_CONSUMER_TIMEOUT_SECONDS", "60")
            ),
        )

    def validate(self) -> None:
        parsed = urllib.parse.urlparse(self.webgis_base_url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ConsumerError(
                "PASC_CONSUMER_CONFIG_INVALID",
                "WebGIS消费者地址配置无效。",
                retryable=False,
            )
        if len(self.api_key) < 32:
            raise ConsumerError(
                "PASC_CONSUMER_CONFIG_INVALID",
                "消费者密钥必须至少32字符。",
                retryable=False,
            )
        if not self.worker_id or len(self.worker_id) > 120:
            raise ConsumerError(
                "PASC_CONSUMER_CONFIG_INVALID",
                "消费者workerId无效。",
                retryable=False,
            )
        if not 60 <= self.lease_seconds <= 1800:
            raise ConsumerError(
                "PASC_CONSUMER_CONFIG_INVALID",
                "消费者租约必须为60—1800秒。",
                retryable=False,
            )


class JobTransport(Protocol):
    def claim(self) -> dict[str, Any] | None: ...
    def open_source(
        self, claim: dict[str, Any]
    ) -> tuple[BinaryIO, int]: ...
    def progress(
        self, claim: dict[str, Any], payload: dict[str, Any]
    ) -> bool: ...
    def put_artifact(
        self,
        claim: dict[str, Any],
        kind: str,
        chunk_index: int,
        content_type: str,
        body: bytes,
        record_count: int,
    ) -> None: ...
    def complete(
        self,
        claim: dict[str, Any],
        summary: dict[str, Any],
        model: dict[str, Any],
    ) -> None: ...
    def fail(
        self,
        claim: dict[str, Any],
        code: str,
        message: str,
        retryable: bool,
    ) -> None: ...


class HttpJobTransport:
    def __init__(self, config: ConsumerConfig):
        config.validate()
        self.config = config
        self.base = config.webgis_base_url.rstrip("/") + "/"

    def _safe_url(self, path: str) -> str:
        if (
            not isinstance(path, str)
            or not path.startswith("/v1/internal/jobs/")
            or path.startswith("//")
            or "://" in path
        ):
            raise ConsumerError(
                "PASC_CONSUMER_PATH_INVALID",
                "任务返回了无效内部路径。",
                retryable=False,
            )
        url = urllib.parse.urljoin(self.base, path.lstrip("/"))
        if urllib.parse.urlparse(url).netloc != urllib.parse.urlparse(
            self.base
        ).netloc:
            raise ConsumerError(
                "PASC_CONSUMER_PATH_INVALID",
                "内部路径越过已配置WebGIS来源。",
                retryable=False,
            )
        return url

    def _request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ):
        merged = {
            "authorization": "Bearer " + self.config.api_key,
            "user-agent": "pasc-tcn-phase-f-consumer/1",
        }
        merged.update(headers or {})
        request = urllib.request.Request(
            self._safe_url(path),
            data=body,
            method=method,
            headers=merged,
        )
        try:
            return urllib.request.urlopen(
                request,
                timeout=self.config.request_timeout_seconds,
            )
        except urllib.error.HTTPError as error:
            raw = error.read(65536)
            try:
                payload = json.loads(raw.decode("utf-8"))
                machine = payload.get("error", {})
                code = machine.get("code", "PASC_JOB_TRANSPORT_FAILED")
                message = machine.get(
                    "message", "任务编排服务暂时不可用。"
                )
            except (UnicodeDecodeError, json.JSONDecodeError):
                code = "PASC_JOB_TRANSPORT_FAILED"
                message = "任务编排服务暂时不可用。"
            raise ConsumerError(
                str(code),
                str(message),
                retryable=error.code >= 500 or error.code == 409,
            ) from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise ConsumerError(
                "PASC_JOB_TRANSPORT_FAILED",
                "任务编排服务暂时不可用。",
            ) from error

    @staticmethod
    def _json(response) -> dict[str, Any]:
        raw = response.read()
        if not raw:
            return {}
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ConsumerError(
                "PASC_JOB_RESPONSE_INVALID",
                "任务编排服务返回了无效JSON。",
            ) from error
        if not isinstance(value, dict):
            raise ConsumerError(
                "PASC_JOB_RESPONSE_INVALID",
                "任务编排服务返回结构无效。",
            )
        return value

    def claim(self) -> dict[str, Any] | None:
        body = json.dumps(
            {
                "workerId": self.config.worker_id,
                "leaseSeconds": self.config.lease_seconds,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        response = self._request(
            "POST",
            "/v1/internal/jobs/claim",
            body,
            {"content-type": "application/json"},
        )
        if response.status == 204:
            response.close()
            return None
        with response:
            claim = self._json(response)
        token = claim.get("leaseToken")
        if not isinstance(token, str) or len(token) < 16:
            raise ConsumerError(
                "PASC_JOB_RESPONSE_INVALID",
                "任务认领响应缺少租约。",
            )
        return claim

    def _lease_headers(self, claim: dict[str, Any]) -> dict[str, str]:
        return {"x-pasc-lease-token": str(claim["leaseToken"])}

    def open_source(
        self, claim: dict[str, Any]
    ) -> tuple[BinaryIO, int]:
        response = self._request(
            "GET",
            str(claim["sourcePath"]),
            headers=self._lease_headers(claim),
        )
        return response, int(response.headers.get("content-length", "0"))

    def progress(
        self, claim: dict[str, Any], payload: dict[str, Any]
    ) -> bool:
        body = json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        response = self._request(
            "POST",
            str(claim["progressPath"]),
            body,
            {
                **self._lease_headers(claim),
                "content-type": "application/json",
            },
        )
        with response:
            result = self._json(response)
        return bool(result.get("cancelRequested"))

    def put_artifact(
        self,
        claim: dict[str, Any],
        kind: str,
        chunk_index: int,
        content_type: str,
        body: bytes,
        record_count: int,
    ) -> None:
        path = (
            str(claim["artifactPath"])
            + "?kind="
            + urllib.parse.quote(kind)
            + "&chunk="
            + str(chunk_index)
        )
        response = self._request(
            "PUT",
            path,
            body,
            {
                **self._lease_headers(claim),
                "content-type": content_type,
                "content-length": str(len(body)),
                "x-content-sha256": hashlib.sha256(body).hexdigest(),
                "x-record-count": str(record_count),
            },
        )
        response.close()

    def complete(
        self,
        claim: dict[str, Any],
        summary: dict[str, Any],
        model: dict[str, Any],
    ) -> None:
        body = json.dumps(
            {"summary": summary, "model": model},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        response = self._request(
            "POST",
            str(claim["completePath"]),
            body,
            {
                **self._lease_headers(claim),
                "content-type": "application/json",
            },
        )
        response.close()

    def fail(
        self,
        claim: dict[str, Any],
        code: str,
        message: str,
        retryable: bool,
    ) -> None:
        body = json.dumps(
            {
                "code": code,
                "message": message,
                "retryable": retryable,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        try:
            response = self._request(
                "POST",
                str(claim["failPath"]),
                body,
                {
                    **self._lease_headers(claim),
                    "content-type": "application/json",
                },
            )
            response.close()
        except ConsumerError:
            pass


class CountingTextLines:
    def __init__(self, source: BinaryIO):
        self.source = source
        self.bytes_read = 0
        self.first = True

    def __iter__(self):
        for raw in self.source:
            self.bytes_read += len(raw)
            text = raw.decode("utf-8-sig" if self.first else "utf-8")
            self.first = False
            yield text


class MapReservoir:
    def __init__(self, job_id: str, capacity: int = MAX_MAP_POINTS):
        self.job_id = job_id
        self.capacity = capacity
        self.heap: list[tuple[int, str, dict[str, Any]]] = []

    def add(self, item: dict[str, Any]) -> None:
        point_id = str(item["pointId"])
        score = int.from_bytes(
            hashlib.sha256(
                (self.job_id + ":" + point_id).encode("utf-8")
            ).digest()[:8],
            "big",
        )
        entry = (-score, point_id, item)
        if len(self.heap) < self.capacity:
            heapq.heappush(self.heap, entry)
        elif entry > self.heap[0]:
            heapq.heapreplace(self.heap, entry)

    def levels(self) -> Iterable[tuple[str, list[dict[str, Any]]]]:
        ordered = [
            item
            for _score, _point_id, item in sorted(
                self.heap, key=lambda value: (-value[0], value[1])
            )
        ]
        for kind, limit in MAP_LEVELS:
            yield kind, ordered[:limit]


def _finite(value: Any) -> bool:
    try:
        number = float(value)
        return number == number and abs(number) != float("inf")
    except (TypeError, ValueError):
        return False


def _gzip_json(value: Any) -> bytes:
    return gzip.compress(
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8"),
        compresslevel=6,
        mtime=0,
    )


def _gzip_ndjson(values: list[dict[str, Any]]) -> bytes:
    raw = b"".join(
        (
            json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            )
            + "\n"
        ).encode("utf-8")
        for value in values
    )
    return gzip.compress(raw, compresslevel=6, mtime=0)


def _map_item(
    row: dict[str, Any],
    mapping: dict[str, Any],
    result: dict[str, Any],
) -> dict[str, Any]:
    return {
        "pointId": result["pointId"],
        "longitude": float(row[str(mapping["lon"])]),
        "latitude": float(row[str(mapping["lat"])]),
        "finalLabel": result["finalLabel"],
        "probabilities": result["probabilities"],
        "confidence": result["confidence"],
        "lowConfidence": result["lowConfidence"],
        "spatialReliability": result["spatialReliability"],
        "spatialGateMean": result["spatialGateMean"],
        "applicability": result["applicability"],
        "calibrationChanged": result["calibrationChanged"],
        "sources": result["sources"],
        "warnings": result["warnings"],
        "quality": result["quality"],
    }


class PascJobConsumer:
    def __init__(
        self,
        transport: JobTransport,
        preprocess_fn: Callable[[dict[str, Any]], dict[str, Any]] = preprocess_payload,
        infer_fn: Callable[[dict[str, Any]], dict[str, Any]] = infer_payload,
    ):
        self.transport = transport
        self.preprocess_fn = preprocess_fn
        self.infer_fn = infer_fn

    def run_once(self) -> bool:
        claim = self.transport.claim()
        if claim is None:
            return False
        try:
            self._execute(claim)
        except JobCancelled as error:
            self.transport.fail(
                claim, error.code, str(error), retryable=False
            )
        except ConsumerError as error:
            self.transport.fail(
                claim, error.code, str(error), retryable=error.retryable
            )
        except Exception:
            self.transport.fail(
                claim,
                "PASC_JOB_CONSUMER_FAILED",
                "Python消费者处理失败。",
                retryable=True,
            )
        return True

    def _execute(self, claim: dict[str, Any]) -> None:
        request = claim.get("request")
        job = claim.get("job")
        if not isinstance(request, dict) or not isinstance(job, dict):
            raise ConsumerError(
                "PASC_JOB_RESPONSE_INVALID",
                "任务请求配置无效。",
                retryable=False,
            )
        mapping = request.get("mapping")
        settings = request.get("settings")
        date_columns = request.get("dateColumns")
        if (
            not isinstance(mapping, dict)
            or not isinstance(settings, dict)
            or not isinstance(date_columns, list)
            or len(date_columns) < 40
        ):
            raise ConsumerError(
                "PASC_JOB_MAPPING_REQUIRED",
                "任务缺少已确认字段映射。",
                retryable=False,
            )
        chunk_size = max(
            40,
            min(
                MAX_CHUNK_SIZE,
                int(job.get("chunks", {}).get("size", 256)),
            ),
        )
        job_id = str(job.get("jobId", ""))
        reservoir = MapReservoir(job_id)
        source, source_size = self.transport.open_source(claim)
        lines = CountingTextLines(source)
        reader = csv.DictReader(lines)
        if not reader.fieldnames:
            source.close()
            raise ConsumerError(
                "PASC_SCHEMA_UNRESOLVED",
                "CSV缺少表头。",
                retryable=False,
            )
        required = {
            str(mapping.get("lon", "")),
            str(mapping.get("lat", "")),
            *[str(value) for value in date_columns],
        }
        missing = sorted(field for field in required if field not in reader.fieldnames)
        if missing:
            source.close()
            raise ConsumerError(
                "PASC_SCHEMA_UNRESOLVED",
                "已确认字段不在CSV表头中。",
                retryable=False,
            )

        total = 0
        predicted = 0
        unsupported = 0
        artifact_chunk = 0
        rows_chunk: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        aggregate = {
            "lowConfidence": 0,
            "limitedReference": 0,
            "classes": {},
        }
        model: dict[str, Any] | None = None

        def report(stage: str, message: str) -> None:
            progress = (
                min(95.0, lines.bytes_read / source_size * 95.0)
                if source_size > 0
                else min(95.0, artifact_chunk * 0.5)
            )
            cancelled = self.transport.progress(
                claim,
                {
                    "stage": stage,
                    "progress": progress,
                    "processedPoints": total,
                    "predictedPoints": predicted,
                    "unsupportedPoints": unsupported,
                    "currentChunk": artifact_chunk,
                    "totalChunks": int(
                        job.get("chunks", {}).get("total", 0)
                    ),
                    "totalPoints": int(
                        job.get("points", {}).get("total", 0)
                    ),
                    "message": message,
                },
            )
            if cancelled:
                raise JobCancelled()

        report("downloading", "已开始流式读取原始CSV")
        try:
            for row_number, raw_row in enumerate(reader, start=2):
                total += 1
                row = dict(raw_row)
                if not mapping.get("id"):
                    row["__pasc_point_id"] = "row-" + str(row_number)
                point_id_field = str(mapping.get("id") or "__pasc_point_id")
                point_id = str(row.get(point_id_field) or "row-" + str(row_number))
                valid_dates = sum(
                    _finite(row.get(str(field))) for field in date_columns
                )
                if (
                    not _finite(row.get(str(mapping["lon"])))
                    or not _finite(row.get(str(mapping["lat"])))
                ):
                    unsupported += 1
                    errors.append(
                        {
                            "row": row_number,
                            "pointId": point_id,
                            "code": "PASC_SCHEMA_UNRESOLVED",
                            "message": "经纬度无效。",
                        }
                    )
                    continue
                if valid_dates < 40:
                    unsupported += 1
                    errors.append(
                        {
                            "row": row_number,
                            "pointId": point_id,
                            "code": "PASC_TOO_FEW_VALID_EPOCHS",
                            "message": "逐点有效日期少于40。",
                        }
                    )
                    continue
                rows_chunk.append(row)
                if len(rows_chunk) < chunk_size:
                    continue
                chunk_results, chunk_model = self._process_rows(
                    claim,
                    request,
                    mapping,
                    point_id_field,
                    rows_chunk,
                    artifact_chunk,
                    errors,
                )
                if chunk_model:
                    if model and model.get("buildHash") != chunk_model.get("buildHash"):
                        raise ConsumerError(
                            "PASC_MODEL_VERSION_DRIFT",
                            "任务处理中模型构建发生变化。",
                            retryable=False,
                        )
                    model = chunk_model
                for source_row, result in chunk_results:
                    predicted += 1
                    aggregate["lowConfidence"] += int(
                        bool(result["lowConfidence"])
                    )
                    aggregate["limitedReference"] += int(
                        result["applicability"]["spatial"]
                        == "limited_reference"
                    )
                    label = result["finalLabel"]["className"]
                    aggregate["classes"][label] = (
                        aggregate["classes"].get(label, 0) + 1
                    )
                    reservoir.add(_map_item(source_row, mapping, result))
                unsupported = len(errors)
                artifact_chunk += 1
                rows_chunk = []
                report("inference", "已完成第%d个推理分块" % artifact_chunk)

            if rows_chunk:
                chunk_results, chunk_model = self._process_rows(
                    claim,
                    request,
                    mapping,
                    point_id_field,
                    rows_chunk,
                    artifact_chunk,
                    errors,
                )
                if chunk_model:
                    if model and model.get("buildHash") != chunk_model.get("buildHash"):
                        raise ConsumerError(
                            "PASC_MODEL_VERSION_DRIFT",
                            "任务处理中模型构建发生变化。",
                            retryable=False,
                        )
                    model = chunk_model
                for source_row, result in chunk_results:
                    predicted += 1
                    aggregate["lowConfidence"] += int(
                        bool(result["lowConfidence"])
                    )
                    aggregate["limitedReference"] += int(
                        result["applicability"]["spatial"]
                        == "limited_reference"
                    )
                    label = result["finalLabel"]["className"]
                    aggregate["classes"][label] = (
                        aggregate["classes"].get(label, 0) + 1
                    )
                    reservoir.add(_map_item(source_row, mapping, result))
                artifact_chunk += 1
                unsupported = len(errors)
        finally:
            source.close()

        if predicted == 0 or model is None:
            raise ConsumerError(
                "PASC_TOO_FEW_VALID_EPOCHS",
                "任务没有可推理的有效点。",
                retryable=False,
            )

        report("writing", "正在写回摘要、审计与多级地图样本")
        validation = {
            "contractVersion": CONTRACT_VERSION,
            "jobId": job_id,
            "totalRows": total,
            "predicted": predicted,
            "unsupported": unsupported,
            "dateColumns": len(date_columns),
            "mappingConfirmed": True,
        }
        self._put_json(claim, "validation", validation, total)
        for kind, points in reservoir.levels():
            self._put_json(
                claim,
                kind,
                {
                    "contractVersion": CONTRACT_VERSION,
                    "modelVersion": model["modelVersion"],
                    "jobId": job_id,
                    "strategy": "deterministic_multilevel_decimation",
                    "returnedPoints": len(points),
                    "totalPredictedPoints": predicted,
                    "points": points,
                },
                len(points),
            )
        if errors:
            csv_buffer = io.StringIO()
            writer = csv.DictWriter(
                csv_buffer,
                fieldnames=["row", "pointId", "code", "message"],
            )
            writer.writeheader()
            writer.writerows(errors)
            error_body = gzip.compress(
                csv_buffer.getvalue().encode("utf-8"),
                compresslevel=6,
                mtime=0,
            )
            self.transport.put_artifact(
                claim,
                "errors",
                -1,
                "text/csv",
                error_body,
                len(errors),
            )

        summary = {
            "points": total,
            "predicted": predicted,
            "unsupported": unsupported,
            "lowConfidence": aggregate["lowConfidence"],
            "limitedReference": aggregate["limitedReference"],
            "classes": aggregate["classes"],
            "chunks": artifact_chunk,
            "mapStrategy": "deterministic_multilevel_decimation",
            "mapMaximumPoints": MAX_MAP_POINTS,
        }
        audit = {
            "contractVersion": CONTRACT_VERSION,
            "modelVersion": model["modelVersion"],
            "serviceVersion": model["serviceVersion"],
            "modelPackage": model["modelPackage"],
            "userDataFit": False,
            "trainingPathAvailable": False,
            "consumer": "phase_f_python_consumer_v1",
            "attempt": claim.get("attempt"),
        }
        self._put_json(claim, "summary", summary, 1)
        self._put_json(claim, "audit", audit, 1)
        self.transport.progress(
            claim,
            {
                "stage": "finalizing",
                "progress": 99,
                "processedPoints": total,
                "predictedPoints": predicted,
                "unsupportedPoints": unsupported,
                "currentChunk": artifact_chunk,
                "totalChunks": artifact_chunk,
                "totalPoints": total,
                "message": "结果工件已写回，正在完成任务",
            },
        )
        self.transport.complete(
            claim,
            summary,
            {
                "serviceVersion": model["serviceVersion"],
                "buildHash": model["modelPackage"]["buildHash"],
                "manifestSha256": model["modelPackage"][
                    "manifestSha256"
                ],
                "assetSha256": model["modelPackage"]["assetSha256"],
            },
        )

    def _process_rows(
        self,
        claim: dict[str, Any],
        request: dict[str, Any],
        mapping: dict[str, Any],
        point_id_field: str,
        rows: list[dict[str, Any]],
        chunk_index: int,
        errors: list[dict[str, Any]],
    ) -> tuple[
        list[tuple[dict[str, Any], dict[str, Any]]],
        dict[str, Any] | None,
    ]:
        service_mapping = {
            "pointId": point_id_field,
            "longitude": mapping["lon"],
            "latitude": mapping["lat"],
            "velocity": mapping.get("velocity") or None,
            "coherence": mapping.get("coherence") or None,
            "dateColumns": request["dateColumns"],
        }

        def infer_subset(
            subset: list[dict[str, Any]],
        ) -> tuple[
            list[tuple[dict[str, Any], dict[str, Any]]],
            list[dict[str, Any]],
            dict[str, Any] | None,
        ]:
            payload = {
                "contractVersion": CONTRACT_VERSION,
                "datasetName": request.get(
                    "datasetName", "Phase F job"
                ),
                "mapping": service_mapping,
                "settings": request["settings"],
                "records": subset,
            }
            try:
                preprocessed = self.preprocess_fn(payload)
                inferred = self.infer_fn(
                    {
                        "contractVersion": CONTRACT_VERSION,
                        "preprocessed": preprocessed,
                    }
                )
            except ServiceError as error:
                if len(subset) > 1:
                    middle = len(subset) // 2
                    left, left_fragments, left_model = infer_subset(
                        subset[:middle]
                    )
                    right, right_fragments, right_model = infer_subset(
                        subset[middle:]
                    )
                    if (
                        left_model
                        and right_model
                        and left_model.get("modelPackage", {}).get(
                            "buildHash"
                        )
                        != right_model.get("modelPackage", {}).get(
                            "buildHash"
                        )
                    ):
                        raise ConsumerError(
                            "PASC_MODEL_VERSION_DRIFT",
                            "任务处理中模型构建发生变化。",
                            retryable=False,
                        )
                    return (
                        left + right,
                        left_fragments + right_fragments,
                        left_model or right_model,
                    )
                point_id = str(
                    subset[0].get(point_id_field, "unknown")
                )
                errors.append(
                    {
                        "row": -1,
                        "pointId": point_id,
                        "code": error.code,
                        "message": "该点未通过权威预处理或推理。",
                    }
                )
                return [], [], None

            by_id = {
                str(row.get(point_id_field)): row for row in subset
            }
            paired = [
                (by_id[str(result["pointId"])], result)
                for result in inferred["points"]
                if str(result["pointId"]) in by_id
            ]
            model = {
                "contractVersion": inferred["contractVersion"],
                "modelVersion": inferred["modelVersion"],
                "serviceVersion": inferred["serviceVersion"],
                "modelPackage": inferred["modelPackage"],
            }
            return paired, [preprocessed], model

        paired, fragments, model = infer_subset(rows)
        if paired:
            self.transport.put_artifact(
                claim,
                "preprocessed",
                chunk_index,
                "application/gzip",
                _gzip_json(
                    {
                        "format": "sealed_preprocessed_fragments_v1",
                        "fragments": fragments,
                    }
                ),
                len(paired),
            )
            self.transport.put_artifact(
                claim,
                "predictions",
                chunk_index,
                "application/x-ndjson+gzip",
                _gzip_ndjson([result for _row, result in paired]),
                len(paired),
            )
        return paired, model

    def _put_json(
        self,
        claim: dict[str, Any],
        kind: str,
        value: dict[str, Any],
        record_count: int,
    ) -> None:
        body = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        self.transport.put_artifact(
            claim,
            kind,
            -1,
            "application/json; charset=utf-8",
            body,
            record_count,
        )


def run_forever(config: ConsumerConfig | None = None) -> None:
    selected = config or ConsumerConfig.from_env()
    selected.validate()
    consumer = PascJobConsumer(HttpJobTransport(selected))
    while True:
        worked = consumer.run_once()
        if not worked:
            time.sleep(max(0.5, selected.poll_seconds))
