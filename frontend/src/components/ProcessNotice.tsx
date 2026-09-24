import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { CopyProblem } from "./CopyProblem";
import { formatTime } from "../lib/format";
import type { ProcessStatus } from "../hooks/useVersions";

/** 转录进度/错误提示条：转写中显示进度条，失败显示原因与操作按钮。 */
export interface ProcessNoticeProps {
  text: string;
  card?: boolean;
  compact?: boolean;
  engine?: string;
  elapsed?: number;
  status: ProcessStatus;
  phase: "uploading" | "sending" | "processing" | string;
  ratio: number;
  hint: string;
  raw: string;
  cancelTranscription: () => void;
  setTranscriptionDialogOpen: (open: boolean) => void;
  setSaveToast: (toast: { kind: "error" | "ok"; text: string }) => void;
}

export function ProcessNotice(props: ProcessNoticeProps) {
  useInterfaceLanguage();
  const {
    text,
    status,
    phase,
    ratio,
    hint,
    cancelTranscription,
    setTranscriptionDialogOpen,
  } = props;

  // 读取和上传有真实进度；识别阶段仅显示活动指示，不伪造百分比。
  const hasRatio = phase === "uploading" || phase === "sending";

  if (props.card) {
    const running = status === "transcribing";
    const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    const stage = phase === "uploading" ? msg('ProcessNotice.m0634') : phase === "sending" ? msg('ProcessNotice.m0635') : phase === "saving" ? msg('ProcessNotice.m0636') : msg('ProcessNotice.m0637');
    return <section className={`transcription-card${props.compact ? " transcription-card--compact" : ""}${running ? "" : " transcription-card--error"}`} aria-label={running ? msg('ProcessNotice.m0638') : msg('ProcessNotice.m0639')}>
      <div className="transcription-card-heading">
        {running && <span className="transcription-signal" aria-hidden="true"><i/><i/><i/><i/><i/></span>}
        <div><h2>{running ? msg('ProcessNotice.m0640') : msg('ProcessNotice.m0641')}</h2>
          {running && <p className="transcription-card-stage" role="status">{stage}{hasRatio ? ` · ${percent}%` : ""}</p>}
        </div>
      </div>
      {running ? <>
        <ol className="transcription-steps" aria-label={msg('ProcessNotice.m0642')}>
          {[msg('ProcessNotice.m0643'), msg('ProcessNotice.m0644'), msg('ProcessNotice.m0645'), msg('ProcessNotice.m0646')].map((label,index)=>{
            const current=phase==="uploading"?0:phase==="sending"?1:phase==="saving"?3:2;
            return <li key={label} className={index<current?"is-complete":index===current?"is-current":""} aria-current={index===current?"step":undefined}>
              <span aria-hidden="true">{index<current ? "✓" : String(index+1).padStart(2,"0")}</span>{label}
            </li>;
          })}
        </ol>
        {hasRatio && <div className="transcription-card-progress" role="progressbar" aria-label={stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div style={{width:`${percent}%`}}/></div>}
      </> : <div role="alert"><p className="transcription-card-error">{uiMessage(text)}</p>{hint && <p className="transcription-card-hint">{uiMessage(hint)}</p>}</div>}
      <div className="transcription-card-details">
        {props.engine && <div><span className="transcription-detail-label">{msg('ProcessNotice.m0647')}</span><p>{props.engine}</p></div>}
        {running && <div className="transcription-card-time"><span className="transcription-detail-label">{msg('ProcessNotice.m0648')}</span><p aria-label={msg('ProcessNotice.m0649', { v0: formatTime(props.elapsed ?? 0) })}>{formatTime(props.elapsed ?? 0)}</p></div>}
      </div>
      <div className="transcription-card-footer">
        {running && <p>{phase === "saving" ? msg('ProcessNotice.m0650') : msg('ProcessNotice.m0651')}</p>}
        <div className="transcription-card-actions">
          {running ? <button type="button" disabled={phase === "saving"} onClick={cancelTranscription}>{msg('ProcessNotice.m0652')}</button> : <>
            <button type="button" onClick={()=>setTranscriptionDialogOpen(true)}>{msg('ProcessNotice.m0653')}</button>
            <CopyProblem operation="transcription" />
          </>}
        </div>
      </div>
    </section>;
  }

  return (
    <div className={`process-notice process-notice--${status}`} role={status === "error" ? "alert" : "status"}>
      <span />
      <div className="process-notice__body">
        <p>{uiMessage(text)}</p>
        {status === "transcribing" && (
          <div className="process-progress">
            <div
              className="process-progress__bar"
              style={{
                width: hasRatio ? `${Math.round(ratio * 100)}%` : "0%",
              }}
            />
          </div>
        )}
        {status === "error" && hint && <p className="process-notice__hint">{uiMessage(hint)}</p>}
      </div>
      <div className="process-notice__actions">
        {status === "transcribing" && (
          <button type="button" disabled={phase === "saving"} onClick={cancelTranscription}>
            {msg('ProcessNotice.m0654')}</button>
        )}
        {status === "error" && (
          <>
            <button type="button" onClick={() => setTranscriptionDialogOpen(true)}>
              {msg('ProcessNotice.m0655')}</button>
            <CopyProblem operation="transcription" />
          </>
        )}
      </div>
    </div>
  );
}
