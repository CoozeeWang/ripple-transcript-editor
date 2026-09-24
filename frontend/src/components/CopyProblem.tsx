import { msg, useInterfaceLanguage } from '../i18n';
import { useState } from "react";
import { DiagnosticCopyIcon } from "./DiagnosticCopyIcon";
import { problemDetails, readProblems, type Operation, type Problem } from "../lib/diagnostics";

export function CopyProblem({ problem, operation, iconOnly = false }: { problem?: Problem; operation?: Operation; iconOnly?: boolean }) {
  useInterfaceLanguage();
  const [status, setStatus] = useState("");
  return <span className="diagnostic-copy"><button type="button" className={`cred-btn${iconOnly ? " diagnostic-icon" : ""}`} aria-label={msg('CopyProblem.m0378')} title={msg('CopyProblem.m0379')} onClick={async () => {
    const entry = problem ?? readProblems().filter(p => !operation || p.operation === operation).at(-1);
    if (!entry) { setStatus(msg('CopyProblem.m0380')); return; }
    try {
      await navigator.clipboard.writeText(problemDetails(entry));
      setStatus(iconOnly ? "" : msg('CopyProblem.m0381'));
    } catch { setStatus(msg('CopyProblem.m0382')); }
  }}>{iconOnly ? <DiagnosticCopyIcon /> : msg('CopyProblem.m0383')}</button><span role="status">{status}</span></span>;
}
