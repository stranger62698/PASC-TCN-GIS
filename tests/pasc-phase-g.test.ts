import assert from "node:assert/strict";
import test from "node:test";
import { pascApplicabilityPresentation } from "../app/lib/pasc";

test("Phase G limited spatial state uses the mandatory exploratory wording", () => {
  const presentation = pascApplicabilityPresentation("limited_reference");
  assert.deepEqual(presentation, {
    state: "limited_spatial",
    eyebrow: "探索性识别结果",
    line1: "当前数据超出模型主要验证区域，",
    line2: "建议结合人工判读使用。",
    evidence: "空间可靠性与空间门控受限，当前结果主要依赖 TCN 时间分支与运动学物理特征。",
  });
  assert.equal(JSON.stringify(presentation).includes("任意城市高精度"), false);
});

test("Phase G full and unevaluated states remain distinct", () => {
  const full = pascApplicabilityPresentation("full_reference");
  const unsupported = pascApplicabilityPresentation("not_evaluated");
  assert.equal(full.state, "full");
  assert.match(full.evidence, /空间参考共同参与/);
  assert.equal(unsupported.state, "unsupported");
  assert.match(unsupported.evidence, /未评估不等于适用于任意区域/);
});
