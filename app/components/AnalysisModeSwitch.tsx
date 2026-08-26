import type { RenderAttribute } from "../lib/insar-v2";
import { PRIMARY_ANALYSIS_MODES, type PrimaryAnalysisMode } from "../lib/v2-map-analysis";

export function AnalysisModeSwitch({ value, onChange }: { value: RenderAttribute; onChange: (mode: PrimaryAnalysisMode) => void }) {
  return <div className="analysis-color-toggle v2-analysis-mode-switch" role="group" aria-label="主要分析模式">
    <small>分析模式</small>
    {PRIMARY_ANALYSIS_MODES.map(mode => <button
      key={mode.value}
      className={value === mode.value ? "active" : ""}
      title={mode.description}
      aria-pressed={value === mode.value}
      onClick={() => onChange(mode.value)}
    >{mode.label}</button>)}
  </div>;
}