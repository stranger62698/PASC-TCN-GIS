import assert from "node:assert/strict";
import test from "node:test";
import { pascApplicabilityPresentation } from "../app/lib/pasc";

test("Phase G limited spatial state explains the missing local neighborhood", () => {
  const presentation = pascApplicabilityPresentation("limited_reference");
  assert.deepEqual(presentation, {
    state: "limited_spatial",
    eyebrow: "时序 / 物理识别结果",
    line1: "当前点在 500 米内缺少可用研究区邻点，",
    line2: "空间门控未启用，请结合人工判读。",
    evidence: "TCN 时间分支与运动学物理特征已经完成分类。上传研究区存在足够邻点时会自动建立无标签空间上下文；当前点不使用邻点标签，也不会拟合用户数据。",
  });
  assert.equal(JSON.stringify(presentation).includes("任意城市高精度"), false);
});

test("Phase G full and unevaluated states remain distinct", () => {
  const full = pascApplicabilityPresentation("full_reference");
  const unsupported = pascApplicabilityPresentation("not_evaluated");
  assert.equal(full.state, "full");
  assert.match(full.evidence, /空间邻域共同参与/);
  assert.equal(unsupported.state, "unsupported");
  assert.match(unsupported.evidence, /未评估不等于适用于任意区域/);
});
