import { PASC_CLASSES } from "../lib/pasc";
import type { PascPointResult } from "../types/pasc";

export function PascProbabilityBars({ result }: { result: PascPointResult }) {
  return (
    <section className="pasc-probabilities" aria-label="PASC 六分类概率">
      <header><span>校准后六类概率</span><b>Σ 1.000</b></header>
      {PASC_CLASSES.map(item => {
        const probability = result.probabilities[item.name];
        const winner = result.calibratedLabelId === item.id;
        return (
          <div className={winner ? "is-winner" : ""} key={item.id}>
            <label><i style={{ background: item.color }} /><span>{item.nameZh}</span><small>{item.name}</small><b>{(probability * 100).toFixed(1)}%</b></label>
            <span className="pasc-probability-track"><i style={{ width: `${probability * 100}%`, background: item.color }} /></span>
          </div>
        );
      })}
    </section>
  );
}
