"""Generate the Phase B file manifest without including the manifest itself."""

from __future__ import annotations

import argparse
import csv
import hashlib
from pathlib import Path

EXTRA_FILES = (".gitignore", "README.md")
EXCLUDED_PARTS = {"__pycache__", ".pytest_cache", ".venv"}
MANIFEST_NAME = "PHASE_B_FILE_MANIFEST.csv"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    service_root = Path(__file__).resolve().parents[1]
    repository_root = service_root.parent
    paths = [repository_root / item for item in EXTRA_FILES]
    paths.extend(
        path
        for path in service_root.rglob("*")
        if path.is_file()
        and path.name != MANIFEST_NAME
        and not any(part in EXCLUDED_PARTS for part in path.parts)
        and path.suffix != ".pyc"
    )
    rows = []
    for path in sorted(set(paths), key=lambda item: item.relative_to(repository_root).as_posix()):
        relative = path.relative_to(repository_root).as_posix()
        rows.append(
            {
                "path": relative,
                "bytes": path.stat().st_size,
                "sha256": digest(path),
            }
        )
    with args.output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("path", "bytes", "sha256"))
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
