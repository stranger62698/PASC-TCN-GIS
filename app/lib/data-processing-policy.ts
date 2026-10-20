/** Public deployment policy: user CSV content and analysis stay on their device. */
export const USER_DATA_LOCAL_ONLY = true;
/** Account access and data location are independent product policies. */
export const USER_ACCOUNT_REQUIRED = true;
export const LOCAL_DATA_ONLY_CODE = "USER_DATA_LOCAL_ONLY";
export const LOCAL_DATA_ONLY_MESSAGE = "本站仅提供本机数据分析：CSV、时序计算和结果保存在当前电脑，不上传云端或创建后台任务。";
export const LOCAL_DATA_BLOCKED_ENDPOINTS = [
  "api/private-datasets", "api/pasc-jobs", "api/pasc-large-worker",
  "api/pasc/infer", "api/ai/interpret", "api/roadops/review",
] as const;
export const ONLINE_SERVICE_ENDPOINTS = ["api/auth", "api/roadops/driving"] as const;

/** Only named, read-only example entry points can be browsed without an account. */
export function publicWorkspaceAccess(params: URLSearchParams, hasInitialImport = false): boolean {
  return !hasInitialImport && ["haikou", "landslide", "road"].includes(params.get("demo") ?? "")
    && params.get("scope") !== "full" && !params.has("source") && !params.has("intent")
    && !["dataset", "job", "largeJob", "restore"].some(key => params.has(key));
}

export function localDataOnlyResponse() {
  return { error: { code: LOCAL_DATA_ONLY_CODE, message: LOCAL_DATA_ONLY_MESSAGE, retryable: false }, localOnly: true, accountRequired: USER_ACCOUNT_REQUIRED };
}
