import { PASC_CLASSES } from "../lib/pasc";

export function PascPatternLegend({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? "pasc-legend is-compact" : "pasc-legend"} aria-label="PASC-TCN 六分类图例">
      <header><span>固定分类图例</span><small>pasc-contract-v1</small></header>
      <div>
        {PASC_CLASSES.map(item => (
          <article key={item.id}>
            <i style={{ background: item.color }} />
            <b>{item.nameZh}</b>
            <span>{item.name}</span>
            <em>{item.id}</em>
          </article>
        ))}
      </div>
    </section>
  );
}
