"""Frozen Phase B contract constants."""

CONTRACT_VERSION = "pasc-contract-v1"
MODEL_VERSION = "pasc-tcn-haikou-v1"
SERVICE_VERSION = "0.5.0"
TARGET_EPOCHS = 248
SENTINEL_CADENCE_DAYS = 12
MIN_EXPERIMENTAL_EPOCHS = 20
FORMAL_VALIDATION_MIN_EPOCHS = 40
MAX_SYNC_INFER_POINTS = 512
ZSCORE_EPSILON = 1e-5
SG_WINDOW = 9
SG_POLYORDER = 3

FIELD_ALIASES = {
    "pointId": ("FID", "fid", "point_id", "id", "pid", "点号", "点位编号"),
    "longitude": (
        "xpos", "lon", "lng", "longitude", "longitude_wgs84", "X", "经度",
    ),
    "latitude": (
        "ypos", "lat", "latitude", "latitude_wgs84", "Y", "纬度",
    ),
    "velocity": (
        "Vel", "velocity", "rate", "mean_velocity", "avg_velocity",
        "年均速率", "平均速率",
    ),
    "coherence": ("coherence", "coh", "correlation", "平均相干性", "相干性"),
}

REQUIRED_FIELDS = ("pointId", "longitude", "latitude")
OPTIONAL_FIELDS = ("velocity", "coherence")

FEATURE_NAMES = (
    "total",
    "slope",
    "early_slope",
    "late_slope",
    "acceleration",
    "rate_jump",
    "curvature_rms",
    "linear_residual",
    "amplitude",
    "monotonic_subsidence",
    "late_early_ratio",
    "velocity",
    "coherence",
)

DISPLACEMENT_FACTORS_TO_MM = {
    "mm": 1.0, "millimeter": 1.0, "millimeters": 1.0, "毫米": 1.0,
    "cm": 10.0, "centimeter": 10.0, "centimeters": 10.0, "厘米": 10.0,
    "m": 1000.0, "meter": 1000.0, "meters": 1000.0, "米": 1000.0,
}

VELOCITY_FACTORS_TO_MM_PER_YEAR = {
    "mm/year": 1.0, "mm/yr": 1.0, "mm/a": 1.0, "毫米/年": 1.0,
    "cm/year": 10.0, "cm/yr": 10.0, "cm/a": 10.0, "厘米/年": 10.0,
    "m/year": 1000.0, "m/yr": 1000.0, "m/a": 1000.0, "米/年": 1000.0,
}

SIGN_FACTORS_TO_MODEL_NATIVE = {
    "model_native": 1.0,
    "subsidence_negative": 1.0,
    "subsidence_positive": -1.0,
}

PREPROCESSING_STATES = ("raw", "already_smoothed", "unknown")
