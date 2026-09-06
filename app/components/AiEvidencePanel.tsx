"use client";
import { useRef, useState } from "react";
import { runLocalAiTools, type LocalAiContext } from "../lib/ai-tools";
import type { EvidenceAction, LocalAiResult } from "../lib/ai-evidence";

const suggestions = [
  { index: "01", label: "范围概览", detail: "概括点数、速率、质量与主要模式", query: "总结当前范围的重点" },
  { index: "02", label: "区域比较", detail: "比较当前区域与完整数据集的差异", query: "对比当前 AOI 和全数据集" },
  { index: "03", label: "图层关联", detail: "结合已导入的道路、滑坡或建筑图层", query: "分析当前范围与已导入 GIS 图层的空间关系" },
  { index: "04", label: "模式解释", detail: "解释当前点位或区域的形变模式", query: "解释当前范围主要 PASC-TCN 形变模式" },
];
const evidenceLabels = { tool: "数据计算", rag: "方法说明", scope: "分析范围", warning: "使用边界" } as const;

export function AiEvidencePanel({ context, onAction }: { context: LocalAiContext; onAction: (action: EvidenceAction) => void }) {
  const [query, setQuery] = useState("总结当前范围的重点");
  const [result, setResult] = useState<LocalAiResult | null>(null);
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const run = async () => {
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setState("running");
    setError("");
    setProgress(0);
    try {
      const next = await runLocalAiTools(query, context, { signal: nextController.signal, onProgress: (done, total) => setProgress(total ? Math.round(done / total * 100) : 100) });
      setResult(next);
      setState("idle");
      setProgress(100);
    } catch (cause) {
      if ((cause as Error).name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "本地分析失败");
      setState("error");
    }
  };
  return <section className="local-ai-evidence">
    <header><div><small>辅助分析</small><h3>数据分析助手</h3></div><span>当前地图范围</span></header>
    <p>从当前地图、监测点和已导入图层中提取信息，生成可以返回地图核对的分析结果。</p>
    <div className="local-ai-suggestions">{suggestions.map((item) => <button type="button" key={item.index} className={query === item.query ? "active" : ""} onClick={() => setQuery(item.query)}><i>{item.index}</i><span><b>{item.label}</b><small>{item.detail}</small></span></button>)}</div>
    <label className="local-ai-query"><span>分析问题</span><textarea value={query} onChange={(event) => setQuery(event.target.value)} rows={3}/></label>
    <div className="local-ai-run"><button type="button" disabled={state === "running" || !query.trim()} onClick={() => void run()}>{state === "running" ? "正在分析 " + progress + "%" : "生成分析结果"}</button>{state === "running" && <button type="button" onClick={() => { controller.current?.abort(); setState("idle"); }}>取消</button>}</div>
    {error && <div className="local-ai-error" role="alert">{error}</div>}
    {result && <div className="local-ai-result">
      <article><small>分析结果</small>{result.answer.split("\n").map((line) => <p key={line}>{line}</p>)}</article>
      <section className="evidence-stack"><header><span>数据依据</span><b>{result.evidence.length} 项</b></header>{result.evidence.map((item) => <article className={"evidence-" + item.kind} key={item.id}><small>{evidenceLabels[item.kind]}</small><b>{item.label}</b><p>{item.detail}</p>{item.action && <button type="button" onClick={() => onAction(item.action!)}>{item.action.type === "focus-feature" ? "在地图上查看这个要素" : item.action.type === "focus-layer" ? "查看该图层" : "在地图上查看这些点"}</button>}</article>)}</section>
      <footer>结果仅适用于当前数据和地图范围，候选内容需要人工确认。</footer>
    </div>}
  </section>;
}
