import { builtinText } from '../i18n/builtinText';
import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { useEffect, useRef, useState } from "react";
import { aiRequest } from "../lib/aiEditing";
import { EDITING_PRESETS, presetInstructions } from "../lib/editingPresets";
import type { EditingPlan } from "../lib/planForms";
import "./editingPlanSettings.css";

export function EditingPlanSettings() {
  useInterfaceLanguage();
  const [plans, setPlans] = useState<EditingPlan[]>([]);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState("");
  const [draft, setDraft] = useState<EditingPlan | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const request = new AbortController(); controller.current = request;
    void aiRequest<EditingPlan[]>("plans", undefined, request.signal)
      .then(values => { if (!request.signal.aborted) setPlans(values); })
      .catch(e => { if (!request.signal.aborted) setError(e instanceof Error ? e.message : msg('EditingPlanSettings.m0501')); })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [reload]);
  useEffect(() => () => controller.current?.abort(), []);
  async function mutate(plan: EditingPlan, remove = false) {
    if (busy) return;
    if (remove && !window.confirm(msg('EditingPlanSettings.m0502', { v0: plan.name }))) return;
    setBusy(true); setError(""); setNotice("");
    const request = new AbortController(); controller.current = request;
    try {
      const value = await aiRequest<EditingPlan>(`plans/${plan.id}`, remove ? undefined : {
        name: plan.name.trim(), instructions: plan.instructions.trim(), common: plan.common !== false,
      }, request.signal, remove ? "DELETE" : "PUT");
      if (request.signal.aborted) return;
      setPlans(items => remove ? items.filter(p => p.id !== plan.id) : items.map(p => p.id === value.id ? value : p));
      setDraft(null); setNotice(remove ? msg('EditingPlanSettings.m0503') : msg('EditingPlanSettings.m0504'));
    } catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : msg('EditingPlanSettings.m0505')); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  const builtins = EDITING_PRESETS.map(p => ({id: `builtin:${p.id}`, name: p.name, instructions: presetInstructions(p)}));
  return <div className="plan-library">
    <p className="settings-hint">{msg('EditingPlanSettings.m0506')}</p>
    <section className="settings-block">
    <h3>{msg('EditingPlanSettings.m0507')}</h3>
    {builtins.map(plan => <section className="plan-library-card" key={plan.id}>
      <div className="plan-library-heading"><h4>{builtinText(plan.id, plan.name)}</h4><button type="button" className="plan-rule-toggle" aria-expanded={expanded === plan.id} onClick={() => setExpanded(expanded === plan.id ? "" : plan.id)}>{expanded === plan.id ? msg('EditingPlanSettings.m0508') : msg('EditingPlanSettings.m0509')}<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button></div>
      {expanded === plan.id && <div className="plan-library-rules">{builtinText(plan.id, plan.instructions)}</div>}
    </section>)}
    </section>
    <section className="settings-block">
    <h3>{msg('EditingPlanSettings.m0510')}</h3>
    {loading && <p role="status">{msg('EditingPlanSettings.m0511')}</p>}
    {error && <div role="alert">{uiMessage(error)} {!busy && !draft && <button type="button" className="cred-btn" onClick={() => {setLoading(true);setError("");setReload(value => value + 1);}}>{msg('EditingPlanSettings.m0512')}</button>}</div>}
    {notice && <p role="status">{uiMessage(notice)}</p>}
    {!loading && !error && !plans.length && <p className="settings-hint">{msg('EditingPlanSettings.m0513')}</p>}
    {plans.map(plan => <section className="plan-library-card" key={plan.id}>
      <div className="plan-library-heading"><h4>{plan.name}</h4><div className="plan-library-actions">
        <button type="button" className="plan-rule-toggle" aria-expanded={expanded === plan.id} disabled={busy || !!draft} onClick={() => setExpanded(expanded === plan.id ? "" : plan.id)}>{expanded === plan.id ? msg('EditingPlanSettings.m0514') : msg('EditingPlanSettings.m0515')}<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
        <button type="button" className="cred-btn" disabled={busy || !!draft} onClick={() => {setDraft({...plan});setError("");setNotice("");}}>{msg('EditingPlanSettings.m0516')}</button>
        <button type="button" className="cred-btn cred-btn--danger" disabled={busy || !!draft} onClick={() => void mutate(plan, true)}>{msg('EditingPlanSettings.m0517')}</button>
      </div></div>
      {draft?.id === plan.id ? <form onSubmit={e => {e.preventDefault();void mutate(draft);}}>
        <label className="field"><span>{msg('EditingPlanSettings.m0518')}</span><input required maxLength={100} value={draft.name} disabled={busy} onChange={e => setDraft({...draft, name:e.target.value})}/></label>
        <label className="field"><span>{msg('EditingPlanSettings.m0519')}</span><textarea required rows={8} maxLength={6000} value={draft.instructions} disabled={busy} onChange={e => setDraft({...draft, instructions:e.target.value})}/></label>
        <label className="plan-library-common"><input className="ripple-checkbox" type="checkbox" checked={draft.common !== false} disabled={busy} onChange={e => setDraft({...draft, common:e.target.checked})}/>{msg('EditingPlanSettings.m0520')}</label>
        <div className="plan-library-actions"><button type="submit" className="cred-btn cred-btn--primary" disabled={busy || !draft.name.trim() || !draft.instructions.trim()}>{busy ? msg('EditingPlanSettings.m0521') : msg('EditingPlanSettings.m0522')}</button><button type="button" className="cred-btn" disabled={busy} onClick={() => setDraft(null)}>{msg('EditingPlanSettings.m0523')}</button></div>
      </form> : expanded === plan.id && <div className="plan-library-rules">{plan.instructions}</div>}
    </section>)}
    </section>
  </div>;
}
