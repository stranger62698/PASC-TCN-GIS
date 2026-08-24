# Phase G 外区适用性与泛化证据报告

生成时间：2026-08-24T11:13:38.531349+00:00

## 结论

本次是无外部标签的受控稳健性评估，不是外区精度验证，也不支持‘任意城市高精度’表述。坐标平移保持时间序列和13维物理特征不变；当固定海口空间参考不可用时，空间可靠性与门控归零，产品必须降级为探索性识别并提示人工判读。

产品固定文案：

> 探索性识别结果
> 当前数据超出模型主要验证区域，
> 建议结合人工判读使用。

## 冻结边界

- 模型定义、训练参数、13维物理特征、生产空间机制均未改变。
- 未在用户数据上拟合或训练。
- Self-neighborhood 只做离线诊断，未写入预测路径。

## 分支独立证据

- 坐标平移后的 normalized series 最大绝对差：`0`。
- 13维原始物理特征最大绝对差：`0`。
- 冻结缩放后物理特征最大绝对差：`0`。
- 外区空间分支是否全部被抑制：`True`。

## 场景结果

| 场景 | 类型 | 有效期数 | 类别一致率 vs 248 | 最大概率差 | 平均空间可靠性 | 平均门控 | 空间适用性 |
|---|---|---:|---:|---:|---:|---:|---|
| native_248_reference | reference | 248 | 1 | 0 | 0.65595581 | 0.35052429 | full_reference |
| external_golden_shanghai | external_region | 248 | 0 | 0.55307896 | 0 | 0 | limited_reference |
| external_batch_shanghai | external_region | 248 | 0.66666667 | 0.55307896 | 0 | 0 | limited_reference |
| unit_cm_equivalent | unit_equivalence | 248 | 1 | 1.4901161e-08 | 0.65595577 | 0.35052427 | full_reference |
| sign_positive_equivalent | sign_equivalence | 248 | 1 | 0 | 0.65595581 | 0.35052429 | full_reference |
| sampled_160 | sampling_difference | 160 | 1 | 0.0023921207 | 0.65599982 | 0.35087023 | full_reference |
| sampled_80 | sampling_difference | 80 | 1 | 0.031245887 | 0.65604754 | 0.35215362 | full_reference |
| sampled_40 | sampling_difference | 40 | 1 | 0.47098595 | 0.65630386 | 0.34693193 | full_reference |

所有场景 `accuracyEvaluated=false`；上述一致率和概率差仅表示相对冻结基准的受控扰动响应。

## 单位、符号、轨道与采样

- cm/cm-year 与 mm/mm-year 语义等价输入通过冻结单位归一化比较。
- `subsidence_positive` 与 model-native 符号等价输入通过冻结符号归一化比较。
- 40/80/160 节点由同一 248 节点序列确定性端点保留抽样，进入既有实验性时间适配器。
- 轨道差异：`not_evaluable_from_current_contract`。冻结输入契约不包含升降轨或视线几何字段，不能据此给出轨道差异的数值结论。

## Self-neighborhood 实验

- 状态：`evaluated_not_applied`；点数：3。
- 输入构造：`synthetic_three_point_external_cluster_80m_spacing`；合成坐标：`True`。
- 候选平均可靠性：`0.2675706`；预测应用：`False`；产品可用：`False`。
- Self-neighborhood仅为离线实验，未进入冻结模型预测，也不能替代外部标注精度验证。

## 产品适用性

- `full_reference`：海口固定空间参考可用，时间/物理与空间证据共同参与。
- `limited_reference`：固定空间参考不可用或超出验证区，空间可靠性和门控下降，主要依赖 TCN 时间分支与运动学物理特征，必须展示探索性文案。
-`not_evaluated`：没有足够证据给出空间适用性结论。
