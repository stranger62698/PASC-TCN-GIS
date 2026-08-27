# PASC-TCN Phase D 推理服务

该包实现 v4 的 Phase B 预处理接口、Phase C 离线验证工具、Phase D
冻结模型推理边界，以及 Phase F 大数据任务消费者。冻结模型数学与 Phase D
推理契约保持不变；Phase F 只增加持久任务编排、流式分块执行和结果写回。

## 冻结契约

- 契约：`pasc-contract-v1`
- 模型：`pasc-tcn-haikou-v1`
- 六类顺序固定为 Stable、Linear、Piecewise、Decelerating、Accelerating、Undefined
- 先按真实日期排序、去重，再从数据集首日至末日建立严格 12 天日历网格并线性补齐缺测，随后才执行 SG 和后续特征/模型处理；不会把不同长度序列强行拉伸到 248 节点
- 原生 248 期、严格 12 天间隔继续走冻结黄金路径；其他长度标记为 experimental，20–39 个原始观测额外提示证据有限，少于 20 个原始观测不推理
- SG 为 window 9 / polynomial 3；逐行 Z-score epsilon 为 `1e-5`
- 13 维特征、训练 Scaler、动态类 2/3/4 的 1.35 概率校准均冻结
- 空间参考只包含固定训练集 1,036 行；8 邻居、500 m 半径、180 m 距离尺度
- 海口参考半径外的城市不会伪造空间证据，返回 `limited_reference`
- 非 248 节点的 12 天网格不会为匹配空间参考而再次拉伸；此时空间门控归零，只运行时间/物理分类并返回 `limited_reference`

## 私有模型包

checkpoint 和训练空间参考不得提交到 WebGIS 仓库。部署时在私有位置生成或供应模型包：

```powershell
python tools/build_private_model_bundle.py `
  --output-dir .private-model-bundles/pasc-tcn-haikou-v1
```

构建器会验证正式数据、固定 split、checkpoint 和权威模型代码的 SHA-256，
只把 1,036 条训练参考写入包内，并生成 `SHA256SUMS`、资产哈希和 build hash。
服务加载时重新逐项验证；任何缺失、修改或版本/参数不一致都会以
`PASC_MODEL_ASSET_HASH_MISMATCH` 拒绝启动或推理。本地
`.private-model-bundles/` 已被 Git 忽略。

## 安全配置与启动

推理运行时需要 Python 3.10+、NumPy 和兼容的 PyTorch。私密值只通过环境变量提供：

```powershell
$env:PYTHONPATH = (Resolve-Path src)
$env:PASC_MODEL_BUNDLE_DIR = (Resolve-Path .private-model-bundles/pasc-tcn-haikou-v1)
$env:PASC_ARTIFACT_SIGNING_KEY = '<至少32字节、仅服务端持有>'
$env:PASC_SERVICE_API_KEY = '<至少32字节、仅调用服务持有>'
$env:PASC_REQUIRE_INFERENCE = '1'
$env:PASC_DEVICE = 'cpu' # 或 cuda / auto
python -m pasc_tcn_service --host 127.0.0.1 --port 8100
```

`PASC_INFER_MAX_CONCURRENCY` 默认 1；`PASC_INFER_QUEUE_TIMEOUT_SECONDS`
默认 5 秒且最大 60 秒；`PASC_INFER_BATCH_SIZE` 默认 1024。同步请求最多 512 点，
JSON 请求体最多 32 MiB。ASGI lifespan 和内置服务器都会在启动阶段验证模型包；
`PASC_REQUIRE_INFERENCE=1` 且模型不可用时 fail closed。

## API

- `GET /v1/models`：模型、运行时、限制与可用状态
- `POST /v1/validate`：字段、日期、单位、符号及能力级别验证
- `POST /v1/preprocess`：按日历构造 12 天等间隔序列并执行权威预处理；配置签名密钥后返回 HMAC 工件
- `POST /v1/infer`：只接受本服务产生且 HMAC 校验通过的 `preprocessed` 工件

推理调用必须携带 `Authorization: Bearer <PASC_SERVICE_API_KEY>`，也支持
`X-PASC-Service-Key`。请求示例：

```json
{
  "contractVersion": "pasc-contract-v1",
  "preprocessed": {
    "contractVersion": "pasc-contract-v1",
    "operation": "preprocess_only",
    "points": [],
    "integrity": {
      "artifactVersion": "pasc-preprocessed-v1",
      "signed": true,
      "algorithm": "HMAC-SHA256"
    }
  }
}
```

实际 `preprocessed` 对象应直接使用 `/v1/preprocess` 完整响应，不能自行裁剪或修改。
返回包含 raw/calibrated 六类概率与标签、最终标签、confidence、lowConfidence、
calibrationChanged、spatialReliability、spatialGateMean、时间/空间适用性、质量、
数据来源、warnings，以及模型包全部资产哈希与审计字段。运行时代码没有
optimizer、backward、fit 或训练入口，也不会按输入 URL 获取数据或记录完整时序/密钥。

## Phase F 消费者

WebGIS 使用 D1 租约作为可恢复的拉取队列。消费者不接收用户提供的 URL，只连接
`PASC_WEBGIS_BASE_URL` 指定的单一来源，并校验所有服务端返回路径仍位于同源的
`/v1/internal/jobs/` 下。源 CSV 逐行读取；WebGIS 当前按最多 100 点安全分批，服务硬上限仍为 512 点，
内存中最多保留一个推理分块。结果写成 attempt/chunk 隔离的 R2 工件。

```powershell
$env:PYTHONPATH = (Resolve-Path src)
$env:PASC_WEBGIS_BASE_URL = 'https://<已部署站点域名>'
$env:PASC_CONSUMER_API_KEY = '<与 WebGIS 相同、至少32字符>'
$env:PASC_CONSUMER_WORKER_ID = 'consumer-01'
$env:PASC_CONSUMER_LEASE_SECONDS = '300'
$env:PASC_MODEL_BUNDLE_DIR = (Resolve-Path .private-model-bundles/pasc-tcn-haikou-v1)
$env:PASC_ARTIFACT_SIGNING_KEY = '<至少32字节、仅服务端持有>'
pasc-tcn-consumer
```

消费者生成 validation、predictions、summary、audit、errors，以及最多 500 / 2,000 /
5,000 点的确定性多级地图工件。取消在进度/分块边界生效；可重试失败由 WebGIS
按有界指数退避重新排队；过期租约由其他消费者安全认领。任务不会启用 optimizer、
backward、fit、训练或用户数据微调。
## Phase G 外区评估

`tools/run_phase_g_external_evaluation.py` 使用 Phase D 黄金夹具和私有哈希校验模型包，
生成 `phase_g_results/phase_g_results.json`、`phase_g_scenarios.csv` 与
`PHASE_G_EXTERNAL_REGION_REPORT.md`。输出只记录路径无关的运行时描述，不写入私有
模型包路径、checkpoint、空间参考矩阵或完整时序。

```powershell
$env:PYTHONPATH = (Resolve-Path src)
python tools/run_phase_g_external_evaluation.py --device cpu
```

坐标平移控制独立验证时间/物理预处理不变且空间参考受限；单位与符号使用语义等价
输入；40/80/160 节点场景只报告相对冻结 248 基准的类别一致率和概率差。
所有场景都标记 `accuracyEvaluated=false`。对于 `limited_reference`，产品固定显示：

> 探索性识别结果
> 当前数据超出模型主要验证区域，
> 建议结合人工判读使用。

Self-neighborhood 使用明确标记的合成
80 m 间距外区坐标，仅计算候选可靠性，从不进入 `infer_payload`。
## 验证

```powershell
$env:PYTHONPATH = 'pasc-tcn-service/src'
python -m unittest discover -s pasc-tcn-service/tests -v
python pasc-tcn-service/tools/generate_phase_d_golden.py `
  --output pasc-tcn-service/tests/fixtures/phase_d_inference_golden.json `
  --device cpu
```

黄金夹具通过正式研究模型独立生成；native-248 继续比较完整黄金结果，其他 12 天网格长度验证可变长推理、
概率归一、适用性、空间可靠度和 gate 输出。
Phase C 仍可通过 `tools/run_phase_c_validation.py` 与
`tools/validate_phase_c_results.py` 离线复核；它不定义支持阈值。
