"use client";

import type { PascPreprocessingState } from "../types/pasc";
import type { PascOnlineFilter, PascOnlineRunState } from "../lib/pasc-online";
import { PHASE_E_MAX_POINTS } from "../lib/pasc-online";

type PascOnlineRecognitionProps = {
  totalPoints: number;
  candidatePoints: number;
  mappingConfirmed: boolean;
  preprocessingState?: PascPreprocessingState;
  blockingIssues: string[];
  runState: PascOnlineRunState;
  lowConfidenceCount: number;
  limitedReferenceCount: number;
  onRun: () => void;
  onFilter: (filter: PascOnlineFilter) => void;
};

const stageState = (complete: boolean, blocked = false) => blocked ? "blocked" : complete ? "complete" : "pending";

export function PascOnlineRecognition({
  totalPoints,
  candidatePoints,
  mappingConfirmed,
  preprocessingState,
  blockingIssues,
  runState,
  lowConfidenceCount,
  limitedReferenceCount,
  onRun,
  onFilter,
}: PascOnlineRecognitionProps) {
  const hasResults = runState.status === "success";
  const overLimit = totalPoints > PHASE_E_MAX_POINTS;
  const blocked = !mappingConfirmed || blockingIssues.length > 0 || candidatePoints === 0 || overLimit;
  const busy = runState.status === "running";
  const confirmedState = preprocessingState === "raw" || preprocessingState === "already_smoothed";
  const stages = [
    { key: "upload", label: "上传与映射", detail: mappingConfirmed ? `${totalPoints.toLocaleString()} 点已载入` : "等待确认字段映射", state: stageState(mappingConfirmed) },
    { key: "confirm", label: "单位 / 符号 / 平滑", detail: confirmedState ? (preprocessingState === "raw" ? "raw · 服务端执行 SG" : "already_smoothed · 不重复平滑") : "需要显式确认", state: stageState(confirmedState, mappingConfirmed && !confirmedState) },
    { key: "compat", label: "能力分级", detail: `${candidatePoints.toLocaleString()} 个 ≥40 期候选`, state: stageState(candidatePoints > 0 && !blockingIssues.length, blockingIssues.length > 0 || overLimit) },
    { key: "infer", label: "安全识别", detail: busy ? "Python 服务正在推理" : hasResults ? `${runState.summary?.predicted ?? 0} 点完成` : "等待启动", state: busy ? "running" : stageState(hasResults, blocked) },
    { key: "map", label: "地图结果", detail: hasResults ? "六类固定色已应用" : "保留当前地图", state: stageState(hasResults) },
  ] as const;

  return (
    <section className="pasc-online-card" aria-label="PASC-TCN 小数据在线识别">
      <header>
        <div><small>PHASE E · SYNCHRONOUS</small><h3>小数据在线识别</h3></div>
        <span>{totalPoints.toLocaleString()} / {PHASE_E_MAX_POINTS} 点</span>
      </header>
      <ol className="pasc-online-stages">
        {stages.map((stage, index) => (
          <li className={`is-${stage.state}`} key={stage.key}>
            <i>{String(index + 1).padStart(2, "0")}</i>
            <span><b>{stage.label}</b><small>{stage.detail}</small></span>
          </li>
        ))}
      </ol>

      {overLimit && <div className="pasc-online-notice is-blocked" role="alert"><b>超出 Phase E 同步边界</b><span>当前数据为 {totalPoints.toLocaleString()} 点；超过 {PHASE_E_MAX_POINTS} 点需进入 Phase F 任务化，本阶段不会自动提交。</span></div>}
      {!overLimit && blockingIssues.length > 0 && <div className="pasc-online-notice is-blocked" role="alert"><b>仍有确认项</b><span>{blockingIssues[0]}</span></div>}
      {!overLimit && mappingConfirmed && candidatePoints === 0 && <div className="pasc-online-notice" role="status"><b>普通 WebGIS 可继续使用</b><span>当前没有达到 40 个有效期的点，不会发送 PASC 请求。</span></div>}

      {runState.status === "error" && <div className="pasc-online-notice is-error" role="alert"><b>识别失败，地图已保留</b><span>{runState.error}</span></div>}
      {hasResults && runState.summary && (
        <div className="pasc-online-result" role="status">
          <div><span>已识别</span><b>{runState.summary.predicted.toLocaleString()}</b><small>点</small></div>
          <div><span>低置信度</span><b>{runState.summary.lowConfidence.toLocaleString()}</b><small>点</small></div>
          <div><span>空间受限</span><b>{runState.summary.limitedReference.toLocaleString()}</b><small>点</small></div>
          <footer><span>{runState.serviceVersion}</span><code>{runState.buildHash?.slice(0, 12)}</code></footer>
        </div>
      )}

      <div className="pasc-online-actions">
        <button className="pasc-online-run" disabled={blocked || busy} onClick={onRun}>
          {busy ? "正在执行预处理与推理…" : runState.status === "error" ? "重试在线识别" : hasResults ? "重新识别当前数据" : "开始在线识别"}
        </button>
        <small>同源代理 · 服务密钥不进入浏览器 · API 失败不清空数据</small>
      </div>

      {hasResults && (
        <div className="pasc-online-filters" aria-label="PASC 结果筛选">
          <span>结果核查</span>
          <button disabled={!lowConfidenceCount} onClick={() => onFilter("lowConfidence")}>低置信度 <b>{lowConfidenceCount}</b></button>
          <button disabled={!limitedReferenceCount} onClick={() => onFilter("limitedReference")}>空间适用性有限 <b>{limitedReferenceCount}</b></button>
        </div>
      )}
    </section>
  );
}
