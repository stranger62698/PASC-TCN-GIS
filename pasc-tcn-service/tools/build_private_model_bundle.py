"""Build the private, deterministic pasc-tcn-haikou-v1 model bundle."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import io
import json
import shutil
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SERVICE_ROOT.parent
sys.path.insert(0, str(SERVICE_ROOT / "src"))

from pasc_tcn_service.contract import (
    CONTRACT_VERSION,
    FEATURE_NAMES,
    MODEL_VERSION,
    SG_POLYORDER,
    SG_WINDOW,
    TARGET_EPOCHS,
    ZSCORE_EPSILON,
)
from pasc_tcn_service.inference import canonical_sha256, file_sha256
from pasc_tcn_service.model_architecture import (
    ARCHITECTURE_VERSION,
    AUTHORITATIVE_SOURCE_SHA256,
)

EXPECTED_HASHES = {
    "data": "e2740b4c20b82357f1acc1f67230fa3972fa9ee624ad1e5073cbfb8c324a8265",
    "split": "956a8162b95712d7abf49102ee8a869fd9620fcf46e811feb86d4642d02f484c",
    "checkpoint": "a45b91c0b8288d87481f5c13db82a574d79a13086b28a49eb148617155ca6107",
    "modelCode": AUTHORITATIVE_SOURCE_SHA256,
}
CLASSES = [
    {"id": 0, "canonicalName": "Stable", "displayNameZh": "稳定型", "color": "#76D65B"},
    {"id": 1, "canonicalName": "Linear", "displayNameZh": "线性型", "color": "#E69F00"},
    {"id": 2, "canonicalName": "Piecewise", "displayNameZh": "分段型", "color": "#0072B2"},
    {"id": 3, "canonicalName": "Decelerating", "displayNameZh": "减速型", "color": "#F0E442"},
    {"id": 4, "canonicalName": "Accelerating", "displayNameZh": "加速型", "color": "#D73027"},
    {"id": 5, "canonicalName": "Undefined", "displayNameZh": "未定义型", "color": "#4D4D4D"},
]


def write_json(path: Path, value) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        + "\n",
        encoding="utf-8",
    )


def assert_hash(path: Path, key: str) -> str:
    actual = file_sha256(path)
    if actual != EXPECTED_HASHES[key]:
        raise RuntimeError(f"{key} SHA-256 mismatch: {actual}")
    return actual


def write_deterministic_npz(path: Path, arrays: dict[str, np.ndarray]) -> None:
    with zipfile.ZipFile(
        path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        for name in sorted(arrays):
            buffer = io.BytesIO()
            np.save(buffer, np.asarray(arrays[name]), allow_pickle=False)
            info = zipfile.ZipInfo(
                filename=f"{name}.npy",
                date_time=(1980, 1, 1, 0, 0, 0),
            )
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, buffer.getvalue(), compress_type=zipfile.ZIP_DEFLATED)


def validate_split(data, frame, model_lib):
    train, validation, test = model_lib.split_random(data.labels)
    frame = frame.copy()
    frame.columns = frame.columns.str.strip()
    frame["Split"] = frame["Split"].str.lower()
    for name, indices in (
        ("train", train),
        ("validation", validation),
        ("test", test),
    ):
        actual = set(
            pd.to_numeric(
                frame.loc[frame["Split"] == name, "Row_Index"],
                errors="raise",
            ).astype(int)
        )
        if actual != set(indices.tolist()):
            raise RuntimeError(f"fixed split mismatch: {name}")
    if (len(train), len(validation), len(test)) != (1036, 183, 523):
        raise RuntimeError("fixed split counts changed")
    return train, validation, test


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build private Phase D frozen model bundle"
    )
    parser.add_argument(
        "--research-root",
        type=Path,
        default=REPOSITORY_ROOT.parent / "fyw0822",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    research = args.research_root.resolve()
    output = args.output_dir.resolve()
    if output.exists():
        raise FileExistsError(
            f"refusing to overwrite existing bundle directory: {output}"
        )
    output.mkdir(parents=True)
    result_root = research / "results" / "04_m1_m4"
    paths = {
        "data": research / "data" / "real6_near300_per_class_sg_verified_deduplicated.csv",
        "split": result_root / "M2_M3_M4_fixed_real_split.csv",
        "checkpoint": result_root / "fraction_1.00_M4.pth",
        "modelCode": research / "code" / "run_spatial_physics_tcn_patent_prototype.py",
    }
    source_hashes = {
        key: assert_hash(path, key)
        for key, path in paths.items()
    }

    sys.path.insert(0, str(research / "code"))
    model_lib = importlib.import_module(
        "run_spatial_physics_tcn_patent_prototype"
    )
    model_lib.seed_everything(model_lib.FIXED_SPLIT_SEED)
    data = model_lib.load_real_data(paths["data"])
    train, validation, test = validate_split(
        data,
        pd.read_csv(paths["split"]),
        model_lib,
    )
    physics_scaled, center, scale = model_lib.robust_scale_physics(
        data.physics,
        train,
    )

    scaler_source = (
        SERVICE_ROOT
        / "src"
        / "pasc_tcn_service"
        / "assets"
        / "physics_scaler.json"
    )
    scaler = json.loads(scaler_source.read_text(encoding="utf-8"))
    np.testing.assert_allclose(center, scaler["center"], atol=1e-7, rtol=0)
    np.testing.assert_allclose(scale, scaler["scale"], atol=1e-7, rtol=0)

    shutil.copyfile(paths["checkpoint"], output / "checkpoint.pth")
    shutil.copyfile(scaler_source, output / "physics_scaler.json")
    write_deterministic_npz(
        output / "spatial_reference.npz",
        {
            "normalizedSeries": data.normalized_series[train].astype(np.float32),
            "physicsScaled": physics_scaled[train].astype(np.float32),
            "coordinatesM": data.coordinates_m[train].astype(np.float32),
            "coherence": data.coherence[train].astype(np.float32),
            "rowIndices": train.astype(np.int64),
        },
    )

    latitude0 = float(
        pd.to_numeric(data.frame["ypos"], errors="raise").mean()
    )
    model_config = {
        "bundleSchema": "pasc-model-bundle-v1",
        "contractVersion": CONTRACT_VERSION,
        "modelVersion": MODEL_VERSION,
        "architectureVersion": ARCHITECTURE_VERSION,
        "authoritativeSourceSha256": AUTHORITATIVE_SOURCE_SHA256,
        "targetSteps": TARGET_EPOCHS,
        "minimumExperimentalSteps": 40,
        "minimumStatus": "experimental",
        "sgWindow": SG_WINDOW,
        "sgPolyorder": SG_POLYORDER,
        "zscoreEpsilon": ZSCORE_EPSILON,
        "featureOrder": list(FEATURE_NAMES),
        "physicsCenter": list(scaler["center"]),
        "physicsScale": list(scaler["scale"]),
        "coherenceDefault": float(scaler["coherenceDefault"]),
        "neighbors": 8,
        "radiusMeters": 500.0,
        "distanceScaleMeters": 180.0,
        "lowConfidenceThreshold": 0.60,
        "referenceRows": 1036,
        "referenceLatitudeDegrees": latitude0,
    }
    write_json(output / "model_config.json", model_config)
    write_json(
        output / "classes.json",
        {"contractVersion": CONTRACT_VERSION, "classes": CLASSES},
    )
    write_json(
        output / "probability_calibration.json",
        {
            "version": "dynamic-class-boost-v1",
            "dynamicClassIds": [2, 3, 4],
            "multiplier": 1.35,
            "renormalize": True,
        },
    )
    write_json(
        output / "reference_split.json",
        {
            "fixedSplitSeed": int(model_lib.FIXED_SPLIT_SEED),
            "splitSha256": source_hashes["split"],
            "trainRows": len(train),
            "validationRows": len(validation),
            "testRows": len(test),
            "trainRowIndices": train.tolist(),
        },
    )

    asset_names = [
        "model_config.json",
        "classes.json",
        "physics_scaler.json",
        "probability_calibration.json",
        "checkpoint.pth",
        "spatial_reference.npz",
        "reference_split.json",
    ]
    first_hashes = {
        name: file_sha256(output / name)
        for name in asset_names
    }
    (output / "SHA256SUMS").write_text(
        "".join(
            f"{first_hashes[name]}  {name}\n"
            for name in sorted(first_hashes)
        ),
        encoding="ascii",
    )
    assets = {
        **first_hashes,
        "SHA256SUMS": file_sha256(output / "SHA256SUMS"),
    }
    build_hash = canonical_sha256(
        {
            "contractVersion": CONTRACT_VERSION,
            "modelVersion": MODEL_VERSION,
            "assets": assets,
        }
    )
    write_json(
        output / "manifest.json",
        {
            "bundleSchema": "pasc-model-bundle-v1",
            "contractVersion": CONTRACT_VERSION,
            "modelVersion": MODEL_VERSION,
            "buildHash": build_hash,
            "assets": assets,
            "sourceHashes": source_hashes,
            "privateAssets": True,
            "userDataIncluded": False,
        },
    )
    print(
        json.dumps(
            {
                "output": str(output),
                "buildHash": build_hash,
                "assets": assets,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
