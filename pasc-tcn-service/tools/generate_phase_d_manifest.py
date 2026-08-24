"""Generate the explicit Phase D delivery SHA-256 manifest."""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SERVICE_ROOT.parent
FILES = [
    ".gitignore",
    "README.md",
    "findings.md",
    "progress.md",
    "task_plan.md",
    "pasc-tcn-service/PHASE_D_COMPLETION_REPORT.md",
    "pasc-tcn-service/README.md",
    "pasc-tcn-service/pyproject.toml",
    "pasc-tcn-service/src/pasc_tcn_service/__init__.py",
    "pasc-tcn-service/src/pasc_tcn_service/__main__.py",
    "pasc-tcn-service/src/pasc_tcn_service/api.py",
    "pasc-tcn-service/src/pasc_tcn_service/contract.py",
    "pasc-tcn-service/src/pasc_tcn_service/errors.py",
    "pasc-tcn-service/src/pasc_tcn_service/inference.py",
    "pasc-tcn-service/src/pasc_tcn_service/model_architecture.py",
    "pasc-tcn-service/src/pasc_tcn_service/preprocessing.py",
    "pasc-tcn-service/src/pasc_tcn_service/security.py",
    "pasc-tcn-service/tests/fixtures/phase_d_inference_golden.json",
    "pasc-tcn-service/tests/test_api.py",
    "pasc-tcn-service/tests/test_phase_d.py",
    "pasc-tcn-service/tools/build_private_model_bundle.py",
    "pasc-tcn-service/tools/generate_phase_d_golden.py",
    "pasc-tcn-service/tools/generate_phase_d_manifest.py",
]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main() -> None:
    output = SERVICE_ROOT / "PHASE_D_FILE_MANIFEST.csv"
    rows = []
    for relative in FILES:
        path = REPOSITORY_ROOT / relative
        if not path.is_file():
            raise FileNotFoundError(relative)
        rows.append((relative, path.stat().st_size, digest(path)))
    with output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(("path", "bytes", "sha256"))
        writer.writerows(rows)
    print(f"wrote {len(rows)} Phase D manifest rows to {output}")


if __name__ == "__main__":
    main()
