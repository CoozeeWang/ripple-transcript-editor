import { msg, uiMessage, useInterfaceLanguage, interfaceLanguage } from '../i18n';
import { readEditingTimings, EDITING_TIMINGS_EVENT, editingTimingsPersistent } from "../lib/editingTimings";
import { useEffect, useState } from "react";
import { diagnosticEnvironment, diagnosticsPersistent, DIAGNOSTICS_EVENT, operations, reasons,
  problemSummary, readProblems, type Problem } from "../lib/diagnostics";
import { CopyProblem } from "./CopyProblem";
import { readTranscriptionTimings, TRANSCRIPTION_TIMINGS_EVENT } from "../lib/transcriptionTimings";
import { DiagnosticCopyIcon } from "./DiagnosticCopyIcon";
import { DiagnosticExportIcon } from "./DiagnosticExportIcon";

interface ServiceProblem { id: string; time: string; operation: string; status: number; reason?: keyof typeof reasons }
const serviceLabels = (): Record<string, string> => ({ ...operations, get service() { return msg('DiagnosticsSettings.m0392'); } });
function cleanServiceProblems(value: unknown): ServiceProblem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is ServiceProblem => p && typeof p.id === "string" && /^[a-f0-9-]{36}$/i.test(p.id) &&
    typeof p.time === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|\+00:00)$/.test(p.time) && Number.isFinite(Date.parse(p.time)) &&
    Object.hasOwn(serviceLabels(), p.operation) && Number.isInteger(p.status) && p.status >= 400 && p.status <= 599)
    .slice(-100).map(({ id, time, operation, status, reason }) => ({ id, time, operation, status, ...(reason && Object.hasOwn(reasons, reason) ? {reason} : {}) }));
}
function statusDescription(status: number) {
  if (status === 401 || status === 403) return msg('DiagnosticsSettings.m0393');
  if (status === 404) return msg('DiagnosticsSettings.m0394');
  if (status === 422 || status === 400) return msg('DiagnosticsSettings.m0395');
  if (status === 429) return msg('DiagnosticsSettings.m0396');
  return status >= 500 ? msg('DiagnosticsSettings.m0397') : msg('DiagnosticsSettings.m0398');
}
export function DiagnosticsSettings() {
  useInterfaceLanguage();
  const [transcriptionTimings, setTranscriptionTimings] = useState(readTranscriptionTimings);
  const [timings, setTimings] = useState(readEditingTimings);
  const [local, setLocal] = useState<Problem[]>(readProblems);
  const [service, setService] = useState<ServiceProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [serviceState, setServiceState] = useState(msg('DiagnosticsSettings.m0399'));
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const update = () => { setLocal(readProblems()); setTimings(readEditingTimings()); setTranscriptionTimings(readTranscriptionTimings()); };
    window.addEventListener(TRANSCRIPTION_TIMINGS_EVENT, update);
    window.addEventListener(EDITING_TIMINGS_EVENT, update);
    window.addEventListener(DIAGNOSTICS_EVENT, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(TRANSCRIPTION_TIMINGS_EVENT, update); window.removeEventListener(EDITING_TIMINGS_EVENT, update); window.removeEventListener(DIAGNOSTICS_EVENT, update); window.removeEventListener("storage", update); };
  }, []);
  useEffect(() => {
    let stale = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    void fetch("/api/diagnostics", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error(msg('review.RS015'));
      const data = await response.json();
      if (!Array.isArray(data.records)) throw new Error(msg('review.RS016'));
      if (!stale) {
        setService(cleanServiceProblems(data.records));
        setServiceState(data.storageAvailable === false ? msg('DiagnosticsSettings.m0400') : "");
      }
    }).catch(() => { if (!stale) setServiceState(msg('DiagnosticsSettings.m0401')); })
      .finally(() => { window.clearTimeout(timer); if (!stale) setLoading(false); });
    return () => { stale = true; window.clearTimeout(timer); controller.abort(); };
  }, [refresh]);
  const records = [
    ...local.map(p => ({ id: p.id, time: p.time, title: problemSummary(p), source: msg('DiagnosticsSettings.m0402'), local: p, status: 0 })),
    ...service.map(p => ({ id: p.id, time: p.time, title: `${serviceLabels()[p.operation]}：${p.reason ? reasons[p.reason] : statusDescription(p.status)}`, source: msg('DiagnosticsSettings.m0403'), local: null, status: p.status })),
  ].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const latestRun = timings.at(-1)?.run;
  const latestTimings = timings.filter(t => t.run === latestRun);
  const total = latestTimings.find(t => t.phase === "total");
  const completedBatches = latestTimings.filter(t => t.phase === "request" && t.status === "ok").length;
  const duration = total ? (total.ms < 60000 ? msg('DiagnosticsSettings.m0404', { v0: (total.ms / 1000).toFixed(1) }) : msg('DiagnosticsSettings.m0405', { v0: Math.floor(total.ms / 60000), v1: Math.floor(total.ms % 60000 / 1000) })) : "";
  const phaseLabels = {prepare:msg('DiagnosticsSettings.m0406'), request:msg('DiagnosticsSettings.m0407'), checkpoint:msg('DiagnosticsSettings.m0408'), final_checkpoint:msg('DiagnosticsSettings.m0409'), publish:msg('DiagnosticsSettings.m0410'), total:msg('DiagnosticsSettings.m0411')};
  const lastTranscription = transcriptionTimings.at(-1);
  const transcriptionPhaseLabels = {preparing:msg('DiagnosticsSettings.m0412'), uploading:msg('DiagnosticsSettings.m0413'),sending:msg('DiagnosticsSettings.m0414'),processing:msg('DiagnosticsSettings.m0415'),saving:msg('DiagnosticsSettings.m0416')};
  return <div className="diagnostics-settings">
    <div className="diagnostic-page-header">
    <p className="settings-hint">{msg('DiagnosticsSettings.m0417')}</p>
        <button type="button" className="cred-btn diagnostic-export diagnostic-icon" aria-label={msg('DiagnosticsSettings.m0418')} title={msg('DiagnosticsSettings.m0419')} disabled={loading} onClick={() => {
          try {
            const report = { ...diagnosticEnvironment(), serviceState, localStorageAvailable: diagnosticsPersistent(),
              local: readProblems(), service, transcriptionTimings: readTranscriptionTimings(), editingTimings: readEditingTimings(), editingTimingsStorageAvailable: editingTimingsPersistent() };
            const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
            const link = document.createElement("a"); link.href = url;
            link.download = msg('DiagnosticsSettings.m0420', { v0: new Date().toISOString().slice(0, 10) });
            document.body.append(link); link.click(); link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setNotice("");
          } catch { setNotice(msg('DiagnosticsSettings.m0421')); }
        }}><DiagnosticExportIcon /></button>
    </div>
    {notice && <p className="settings-hint" role="status">{uiMessage(notice)}</p>}
    <section className="settings-block">
      <div className="diagnostic-toolbar">
        <h3>{msg('DiagnosticsSettings.m0422')}</h3>
      <div className="diagnostic-actions">
        <button type="button" className="cred-btn diagnostic-refresh" aria-label={msg('DiagnosticsSettings.m0423')} title={msg('DiagnosticsSettings.m0424')} disabled={loading} onClick={() => {
          setLocal(readProblems()); setTimings(readEditingTimings()); setTranscriptionTimings(readTranscriptionTimings()); setLoading(true); setRefresh(n => n + 1);
        }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5" /><path d="M20 12a8 8 0 1 0-2.3 5.7M20 7v5" /></svg></button>
      </div>
      </div>
      {serviceState && <p className="settings-hint" role="status">{serviceState}</p>}
      {!diagnosticsPersistent() && <p className="form-error">{msg('DiagnosticsSettings.m0425')}</p>}
      {!records.length && <p className="settings-hint diagnostic-empty">{loading ? msg('DiagnosticsSettings.m0426') : msg('DiagnosticsSettings.m0427')}</p>}
      {!!records.length && <ul className="diagnostic-list diagnostic-problems">{records.map(p => <li key={`${p.source}:${p.id}`}>
        <div className="diagnostic-problem-info"><p>{p.title}</p><small>{new Date(p.time).toLocaleString(interfaceLanguage())} · {p.source}{p.local && p.local.count > 1 ? msg('DiagnosticsSettings.m0428', { v0: p.local.count }) : ""}</small></div>
        {p.local ? <CopyProblem problem={p.local} iconOnly /> : <button type="button" className="cred-btn diagnostic-icon" aria-label={msg('DiagnosticsSettings.m0429')} title={msg('DiagnosticsSettings.m0430')} onClick={async () => {
          try { await navigator.clipboard.writeText(msg('DiagnosticsSettings.m0431', { v0: diagnosticEnvironment().version, v1: p.id, v2: p.time, v3: p.title, v4: p.status })); setNotice(""); }
          catch { setNotice(msg('DiagnosticsSettings.m0432')); }
        }}><DiagnosticCopyIcon /></button>}
      </li>)}</ul>}
    </section>
    <section className="settings-block">
      <div className="settings-heading"><div><h3>{msg('DiagnosticsSettings.m0433')}</h3></div></div>
      {!lastTranscription ? <p className="settings-hint">{msg('DiagnosticsSettings.m0434')}</p> : <>
        <p className="settings-hint">{lastTranscription.status === "ok" ? msg('DiagnosticsSettings.m0435') : lastTranscription.status === "cancelled" ? msg('DiagnosticsSettings.m0436') : msg('DiagnosticsSettings.m0437')} · {(lastTranscription.ms / 1000).toFixed(1)} {msg('DiagnosticsSettings.m0438')}</p>
        <details className="diagnostic-timing-details" key={lastTranscription.run}><summary>{msg('DiagnosticsSettings.m0439')}</summary>
          <p className="settings-hint">{new Date(lastTranscription.time).toLocaleString(interfaceLanguage())} {msg('DiagnosticsSettings.m0440')}</p>
          <ul className="diagnostic-list">{Object.entries(lastTranscription.stages).map(([phase, ms]) => <li key={phase}><p>{transcriptionPhaseLabels[phase as keyof typeof transcriptionPhaseLabels]} · {(ms / 1000).toFixed(2)} {msg('DiagnosticsSettings.m0441')}</p></li>)}</ul>
        </details>
      </>}
    </section>
    <section className="settings-block">
      <div className="settings-heading"><div><h3>{msg('DiagnosticsSettings.m0442')}</h3></div></div>
      {!latestTimings.length ? <p className="settings-hint">{msg('DiagnosticsSettings.m0443')}</p> : <>
        <p className="settings-hint">{total ? `${total.status === "ok" ? msg('DiagnosticsSettings.m0444') : total.status === "cancelled" ? msg('DiagnosticsSettings.m0445') : msg('DiagnosticsSettings.m0446')} · ${duration}` : msg('DiagnosticsSettings.m0447')} · {msg('DiagnosticsSettings.m0448', { count: completedBatches })}</p>
        <details className="diagnostic-timing-details" key={latestRun}>
        <summary>{msg('DiagnosticsSettings.m0449')}</summary>
        <p className="settings-hint">{new Date(latestTimings[0].time).toLocaleString(interfaceLanguage())} · {msg('review.editingCounts', { segmentCount: latestTimings[0].segments, characterCount: latestTimings[0].characters })}</p>
        <p className="settings-hint">{msg('DiagnosticsSettings.m0452')}</p>
        <ul className="diagnostic-list">{latestTimings.map((t, i) => <li key={i}>
          <p>{phaseLabels[t.phase]}{t.phase === "request" ? msg('DiagnosticsSettings.m0453', { v0: t.batch }) : t.phase === "checkpoint" ? msg('DiagnosticsSettings.m0454', { v0: t.batch }) : ""} · {(t.ms / 1000).toFixed(2)} {msg('DiagnosticsSettings.m0455')}{t.status === "failed" ? msg('DiagnosticsSettings.m0456') : t.status === "cancelled" ? msg('DiagnosticsSettings.m0457') : ""}</p>
          {t.phase === "request" && <small>{msg('review.editingCounts', { segmentCount: t.segments, characterCount: t.characters })}</small>}
        </li>)}</ul>
        </details>
      </>}
      {!editingTimingsPersistent() && <p className="form-error">{msg('DiagnosticsSettings.m0460')}</p>}
    </section>
  </div>;
}
