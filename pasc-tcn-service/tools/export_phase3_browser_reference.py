"""Export the frozen private spatial reference into a compact browser-only binary.

The output belongs in ignored artifacts and is served only by Vite's local
development middleware. It must never be copied into a public build.
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = (
    ROOT
    / "pasc-tcn-service"
    / ".private-model-bundles"
    / "pasc-tcn-haikou-v1"
    / "spatial_reference.npz"
)
DEFAULT_OUTPUT = ROOT / "artifacts" / "pasc-tcn-phase3-reference.bin"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    with np.load(args.source, allow_pickle=False) as source:
        series = np.ascontiguousarray(source["normalizedSeries"], dtype="<f4")
        physics = np.ascontiguousarray(source["physicsScaled"], dtype="<f4")
        coordinates = np.ascontiguousarray(source["coordinatesM"], dtype="<f4")
        coherence = np.ascontiguousarray(source["coherence"], dtype="<f4")

    rows, time_steps = series.shape
    if physics.shape != (rows, 13) or coordinates.shape != (rows, 2):
        raise ValueError("unexpected frozen spatial reference dimensions")
    if coherence.shape != (rows,):
        raise ValueError("unexpected frozen coherence dimensions")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as target:
        target.write(b"PASCREF1")
        target.write(struct.pack("<III", rows, time_steps, physics.shape[1]))
        target.write(series.tobytes(order="C"))
        target.write(physics.tobytes(order="C"))
        target.write(coordinates.tobytes(order="C"))
        target.write(coherence.tobytes(order="C"))
    print(f"wrote {args.output} ({args.output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
