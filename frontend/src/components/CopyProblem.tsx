import { msg, useInterfaceLanguage } from '../i18n';
import { SUCCESS_FEEDBACK_MS, useTransientState } from '../hooks/useTransientState';
import { DiagnosticCopyIcon } from "./DiagnosticCopyIcon";
import { problemDetails, readProblems, type Operation, type Problem } from "../lib/diagnostics";

export function CopyProblem({ problem, operation, iconOnly = false }: { problem?: Problem; operation?: Operation; iconOnly?: boolean }) {
  useInterfaceLanguage();
  const [status, setStatus] = useTransientState<'idle' | 'copied' | 'missing' | 'error'>('idle', 'idle', value => value === 'copied' ? SUCCESS_FEEDBACK_MS : null);
  return <span className="diagnostic-copy"><button type="button" className={`cred-btn${iconOnly ? " diagnostic-icon" : ""}`} aria-label={msg('CopyProblem.m0378')} title={msg('CopyProblem.m0379')} onClick={async () => {
    const entry = problem ?? readProblems().filter(p => !operation || p.operation === operation).at(-1);
    setStatus('idle');
    if (!entry) { setStatus('missing'); return; }
    try {
      await navigator.clipboard.writeText(problemDetails(entry));
      setStatus('copied');
    } catch { setStatus('error'); }
  }}>{iconOnly ? <DiagnosticCopyIcon /> : msg('CopyProblem.m0383')}</button><span role={status === 'error' ? 'alert' : 'status'}>{status === 'idle' ? '' : msg(status === 'copied' ? 'CopyProblem.m0381' : status === 'missing' ? 'CopyProblem.m0380' : 'CopyProblem.m0382')}{status !== 'idle' && <button type="button" className="feedback-dismiss" aria-label={msg('notice.dismiss')} onClick={() => setStatus('idle')}>×</button>}</span></span>;
}
