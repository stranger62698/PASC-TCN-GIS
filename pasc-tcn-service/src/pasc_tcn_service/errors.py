"""Machine-readable service errors with Chinese user messages."""


class ServiceError(ValueError):
    def __init__(self, code: str, message: str, *, status: int = 422, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}

    def as_dict(self, contract_version: str) -> dict:
        return {
            "contractVersion": contract_version,
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            },
        }


MESSAGES = {
    "PASC_SCHEMA_UNRESOLVED": "字段映射不完整或存在歧义，请确认后重试。",
    "PASC_DATE_PARSE_FAILED": "未能识别有效的时序日期字段。",
    "PASC_DUPLICATE_DATE_CONFLICT": "同一日期存在数值冲突，不能自动合并。",
    "PASC_UNIT_CONFIRMATION_REQUIRED": "必须明确确认形变和速度单位。",
    "PASC_SIGN_CONFIRMATION_REQUIRED": "必须明确确认形变符号约定。",
    "PASC_PREPROCESSING_STATE_REQUIRED": "必须确认数据是原始序列还是已平滑序列。",
    "PASC_TOO_FEW_VALID_EPOCHS": "有效时相少于40，当前模型不支持。",
    "PASC_PREPROCESS_FAILED": "预处理失败，请检查输入数据。",
    "PASC_BAD_REQUEST": "请求格式无效。",
    "PASC_NOT_FOUND": "接口不存在。",
    "PASC_CONTRACT_VERSION_UNSUPPORTED": "请求的契约版本不受支持。",
    "PASC_MODEL_ASSET_HASH_MISMATCH": "冻结模型资产哈希不匹配，服务拒绝推理。",
    "PASC_MODEL_UNAVAILABLE": "冻结模型当前不可用。",
    "PASC_SERVICE_NOT_CONFIGURED": "推理服务安全配置不完整。",
    "PASC_AUTHORIZATION_FAILED": "推理接口鉴权失败。",
    "PASC_PREPROCESSED_ARTIFACT_INVALID": "预处理工件无效、未签名或已被修改。",
    "PASC_INFERENCE_LIMIT_EXCEEDED": "同步推理点数超过限制。",
    "PASC_INFERENCE_FAILED": "冻结模型推理失败。",
    "PASC_INFERENCE_BUSY": "推理并发已满，请稍后重试。",
    "PASC_SPATIAL_REFERENCE_LIMITED": "该点缺少海口训练空间参考，空间适用性有限。",
}
