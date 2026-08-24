import type { InsarPoint } from "../data/site";
import { summarizePascRegion } from "../lib/pasc";

export function PascRegionStats({ points }: { points: InsarPoint[] }) {
  const stats = summarizePascRegion(points.map(point => point.pasc));
  const classified = stats.reduce((sum, item) => sum + item.count, 0);
  return (
    <section className="pasc-region-stats">
      <header><span>区域 PASC 分布</span><b>{classified.toLocaleString()} 个离线结果</b></header>
      {classified === 0 ? <p>当前区域没有可用的离线 PASC 六分类结果。</p> : <div>{stats.map(item => (
        <article key={item.id}>
          <i style={{ background: item.color }} />
          <span><b>{item.nameZh}</b><small>{item.name}</small></span>
          <strong>{item.count.toLocaleString()}</strong>
          <em>{item.percentage.toFixed(1)}%</em>
        </article>
      ))}</div>}
    </section>
  );
}
