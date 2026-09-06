# Phase 1：PASC-TCN ONNX 一致性验证报告

## 结论

**通过**。固定回归样本的 PyTorch 与 ONNX Runtime 预测类别一致率为 **100.00%**，最大校准概率差异为 **3.57627869e-07**。

本阶段仅导出模型并执行 Python 端一致性验证，未修改正式网页，也未把模型放入 `public/models/`。

## 验证对象

- 模型版本：`pasc-tcn-haikou-v1`
- 契约版本：`pasc-contract-v1`
- 模型 bundle build hash：`473300f1e45fcf7cf2e6830f82ddf03a3f76c8868c802e040bf497c33c25b4c1`
- checkpoint SHA-256：`a45b91c0b8288d87481f5c13db82a574d79a13086b28a49eb148617155ca6107`
- ONNX SHA-256：`a2e56ac8d705cdd85ecb2ae87f73adc593674961a9693a4362fc2d2ec1c77d17`
- ONNX opset：`18`
- PyTorch：`2.12.0+cpu`
- ONNX Runtime：`1.29.0`（CPUExecutionProvider）
- 验证时间（UTC）：`2026-08-28T08:32:43.061767+00:00`

## 固定样本

| 场景 | 样本数 | 时间步 | 类别一致 |
| --- | ---: | ---: | ---: |
| native248 | 3 | 248 | 3/3 |
| adapted40 | 1 | 40 | 1/1 |
| external | 1 | 248 | 1/1 |

总样本数：**5**。

## 数值一致性

| 指标 | 最大绝对差 | 平均绝对差 |
| --- | ---: | ---: |
| logits | 1.43051147e-06 | 4.1226545e-07 |
| 原始 probability | 2.98023224e-07 | 4.46426078e-08 |
| 校准后 probability | 3.57627869e-07 | 5.16549328e-08 |
| confidence | 3.57627869e-07 | 1.54972071e-07 |

- 类别映射：一致
- confidence 定义：`max(calibrated_probabilities)`，一致
- PyTorch / ONNX 原始类别一致率：100.00%
- PyTorch / ONNX 最终类别一致率：100.00%
- PyTorch 与现有测试实际锁定的 Phase D golden 基线（native248、external）：一致
- logits 容差：`0.0001`
- probability 容差：`5e-05`

## 不一致样本

无。

## 验收项

- 类别映射完全一致：通过
- confidence 定义完全一致：通过
- 固定样本预测类别 100% 一致：通过
- 概率差异在浮点容差内：通过
- logits 差异在浮点容差内：通过
- 未改变模型数学结构：通过（ONNX adapter 仅将原模型字典输出展开为三个张量）

## 复现

```powershell
pasc-tcn-service\.venv\Scripts\python.exe pasc-tcn-service\tools\export_pasc_tcn_onnx.py
pasc-tcn-service\.venv\Scripts\python.exe pasc-tcn-service\tools\validate_onnx_parity.py
```

生成的 `artifacts/pasc-tcn.onnx` 与机器可读 JSON 保持为本地产物，不进入版本库；通过后才允许进入 Phase 2 浏览器最小原型。
