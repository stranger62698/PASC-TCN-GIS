"""Generate the Phase C delivery manifest without including the manifest itself."""

from __future__ import annotations

import argparse
import csv
import hashlib
from pathlib import Path

PHASE_C_FILES = (
    "README.md",
    "task_plan.md",
    "findings.md",
    "progress.md",
    "pasc-tcn-service/README.md",
    "pasc-tcn-service/PHASE_C_COMPLETION_REPORT.md",
    "pasc-tcn-service/src/pasc_tcn_service/phase_c.py",
    "pasc-tcn-service/tests/test_phase_c.py",
    "pasc-tcn-service/tools/run_phase_c_validation.py",
    "pasc-tcn-service/tools/validate_phase_c_results.py",
    "pasc-tcn-service/tools/generate_phase_c_manifest.py",
)
RESULT_DIRECTORY = "pasc-tcn-service/phase_c_results"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    repository_root = Path(__file__).resolve().parents[2]
    paths = [repository_root / item for item in PHASE_C_FILES]
    paths.extend(
        path
        for path in (repository_root / RESULT_DIRECTORY).rglob("*")
        if path.is_file()
    )
    missing = [path for path in paths if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"missing Phase C files: {missing}")
    rows = [
        {
            "path": path.relative_to(repository_root).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": digest(path),
        }
        for path in sorted(set(paths), key=lambda item: item.relative_to(repository_root).as_posix())
    ]
    with args.output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("path", "bytes", "sha256"))
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
