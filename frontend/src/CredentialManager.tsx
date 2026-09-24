import { apiErrorMessage } from './i18n/errors';
import { serviceText } from './i18n/serviceText';
import { msg, uiMessage, useInterfaceLanguage } from './i18n';
import { recordProblem } from "./lib/diagnostics";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CredentialField,
  CredentialListView,
  CredentialProfile,
  ProviderInfo,
} from "./types";

const MASK = "••••••••";

/** 单个凭据字段：默认隐藏（password），眼睛图标切换显显/隐藏。 */
export function FieldInput({
  field,
  value,
  onChange,
  visible,
  onToggle,
  disabled,
}: {
  field: CredentialField;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  useInterfaceLanguage();
  const options = field.options ?? [];
  const [manual, setManual] = useState(false);
  const useSelect = options.length > 0 && !field.secret;
  const custom = manual || Boolean(value && !options.includes(value));
  return (
    <label className="cred-field">
      <span className="cred-field__label">
        {serviceText(field.label)}
        {field.required ? <em className="cred-req">*</em> : null}
      </span>
      <span className="cred-field__input">
        {useSelect && <select aria-label={serviceText(field.label)} value={custom ? "__custom__" : value} disabled={disabled}
          onChange={event => {
            const next = event.target.value;
            setManual(next === "__custom__");
            onChange(next === "__custom__" ? "" : next);
          }}>
          <option value="">{msg('CredentialManager.m0056')}</option>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
          {field.allow_custom !== false && <option value="__custom__">{msg('CredentialManager.m0057')}</option>}
        </select>}
        {(!useSelect || custom) && <input
          aria-label={useSelect ? `${serviceText(field.label)} ID` : field.label}
          type={!field.secret && value !== MASK || visible ? "text" : "password"}
          value={value}
          placeholder={disabled ? undefined : serviceText(field.placeholder ?? "")}
          autoComplete="off"
          spellCheck={false}
          readOnly={field.read_only}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />}
        {(field.secret || value === MASK) && <button
          type="button"
          className="cred-eye"
          aria-label={visible ? msg('CredentialManager.m0058') : msg('CredentialManager.m0059')}
          title={visible ? msg('CredentialManager.m0060') : msg('CredentialManager.m0061')}
          onClick={onToggle}
        >
          {visible ? <EyeOpen /> : <EyeClosed />}
        </button>}
      </span>
      {field.description && <small className="cred-field__hint">{serviceText(field.description)}</small>}
    </label>
  );
}

/** 一套档案的本地视图状态：已拉取的密钥值、是否处于编辑态、各字段显隐。 */
export interface ProfileView {
  values: Record<string, string>;
  editing: boolean;
  visible: Record<string, boolean>;
}

async function credentialResponse(response: Response) {
  if (response.ok) return response;
  const data = await response.json().catch(() => null);
  if (response.status === 404 && data?.detail === "Not Found") {
    throw new Error(msg('CredentialManager.m0062'));
  }
  throw new Error(apiErrorMessage(data, response.status, msg('CredentialManager.m0063', { v0: response.status })));
}

async function readCredentialLists(base: string) {
  const res = await fetch(base);
  await credentialResponse(res);
  const body = await res.text();
  let provs: ProviderInfo[];
  try {
    provs = JSON.parse(body) as ProviderInfo[];
    if (!Array.isArray(provs)) throw new Error(msg('review.invalidProviderList'));
  } catch {
    throw new Error(msg('CredentialManager.m0064', { v0: body.slice(0, 300) }));
  }
  const entries = await Promise.all(
    provs.map(async (p) => {
      const r = await fetch(`${base}/${p.id}/credentials`);
      await credentialResponse(r);
      const list = (await r.json()) as CredentialListView;
      return [p.id, list] as const;
    }),
  );
  return { providers: provs, lists: Object.fromEntries(entries) };
}

export default function CredentialManager({ kind = "transcription" }: { kind?: "transcription" | "editing" }) {
  useInterfaceLanguage();
  const base = kind === "editing" ? "/api/ai/providers" : "/api/providers";
  const actionName = kind === "editing" ? msg('CredentialManager.m0065') : msg('CredentialManager.m0066');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [lists, setLists] = useState<Record<string, CredentialListView>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [views, setViews] = useState<Record<string, ProfileView>>({});
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [newVisible, setNewVisible] = useState<Record<string, boolean>>({});

  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => readCredentialLists(base)
    .then(({ providers, lists }) => {
      setProviders(providers);
      setLists(lists);
      setError(null);
    })
    .catch((error: unknown) => {
      recordProblem("engine", error);
      setError(error instanceof Error ? error.message : msg('CredentialManager.m0067'));
    })
    .finally(() => setLoading(false)), [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const setView = (profileId: string, patch: Partial<ProfileView>) =>
    setViews((prev) => ({
      ...prev,
      [profileId]: { ...(prev[profileId] ?? { values: {}, editing: false, visible: {} }), ...patch },
    }));

  const reveal = async (providerId: string, profileId: string, fieldKey: string) => {
    setBusy(profileId);
    setError(null);
    try {
      const res = await fetch(`${base}/${providerId}/credentials/${profileId}/reveal`, { cache: "no-store" });
      await credentialResponse(res);
      const data = (await res.json()) as { values: Record<string, string> };
      const list = lists[providerId];
      const visible = Object.fromEntries(list.fields.map((f) => [f.key, !f.secret || f.key === fieldKey]));
      setView(profileId, { values: data.values, editing: false, visible });
    } catch (e) {
      recordProblem("engine", e);
      setError(e instanceof Error ? e.message : msg('CredentialManager.m0068'));
    } finally {
      setBusy(null);
    }
  };

  const startEdit = async (providerId: string, profileId: string) => {
    setBusy(profileId);
    setError(null);
    try {
      // 进入编辑态时先拉取真实密钥值，这样保存时未改动的字段才能保持原值。
      const res = await fetch(`${base}/${providerId}/credentials/${profileId}/reveal`, { cache: "no-store" });
      await credentialResponse(res);
      const data = (await res.json()) as { values: Record<string, string> };
      const list = lists[providerId];
      // 保住编辑前的显隐状态：此前已显示就保持显示，此前隐藏就保持隐藏。
      const prev = views[profileId];
      const wasLoaded = Boolean(prev && Object.keys(prev.values).length > 0);
      const prevVisible = (prev?.visible ?? {}) as Record<string, boolean>;
      const visible = Object.fromEntries(
        list.fields.map((f) => [f.key, wasLoaded ? Boolean(prevVisible[f.key]) : false]),
      );
      setView(profileId, { values: data.values, editing: true, visible });
    } catch (e) {
      recordProblem("engine", e);
      setError(e instanceof Error ? e.message : msg('CredentialManager.m0069'));
    } finally {
      setBusy(null);
    }
  };

  const cancelEdit = (profileId: string) =>
    setView(profileId, { values: {}, editing: false, visible: {} });

  const saveEdit = async (providerId: string, profileId: string) => {
    const view = views[profileId];
    if (!view) return;
    setBusy(profileId);
    setError(null);
    try {
      const res = await fetch(`${base}/${providerId}/credentials/${profileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: view.values.__name__ ?? lists[providerId].profiles.find(p => p.id === profileId)?.name, values: stripName(view.values) }),
      });
      await credentialResponse(res);
      await load();
      setView(profileId, { values: {}, editing: false, visible: {} });
    } catch (e) {
      recordProblem("engine", e);
      setError(e instanceof Error ? e.message : msg('CredentialManager.m0070'));
    } finally {
      setBusy(null);
    }
  };

  const setDefault = async (providerId: string, profileId: string) => {
    setBusy(profileId);
    setError(null);
    try {
      const res = await fetch(
        `${base}/${providerId}/credentials/${profileId}/default`,
        { method: "POST" },
      );
      await credentialResponse(res);
      await load();
    } catch (e) {
      recordProblem("engine", e);
      setError(e instanceof Error ? e.message : msg('CredentialManager.m0071'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (providerId: string, profileId: string) => {
    if (!confirm(msg('CredentialManager.m0072'))) return;
    setBusy(profileId);
    setError(null);
    try {
      const res = await fetch(`${base}/${providerId}/credentials/${profileId}`, {
        method: "DELETE",
      });
      await credentialResponse(res);
      setViews((prev) => {
        const next = { ...prev };
        delete next[profileId];
        return next;
      });
      await load();
    } catch (e) {
      recordProblem("engine", e);
      setError(e instanceof Error ? e.message : msg('CredentialManager.m0073'));
    } finally {
      setBusy(null);
    }
  };

  const startAdd = (providerId: string, list: CredentialListView) => {
    setAddingFor(providerId);
    setNewName("");
    setNewValues(Object.fromEntries(list.fields.map(f => [f.key, f.default_value ?? ""])));
    setNewVisible(Object.fromEntries(list.fields.map((f) => [f.key, false])));
  };

  const saveAdd = async (providerId: string) => {
    setBusy(`add:${providerId}`);
    setError(null);
    try {
      const res = await fetch(`${base}/${providerId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() || [lists[providerId].provider_name, newValues.model].filter(Boolean).join(" · "), values: newValues }),
      });
      await credentialResponse(res);
      setAddingFor(null);
      setNewValues({});
      setNewVisible({});
      await load();
    } catch (e) {
      recordProblem("engine", e);
      setError(e instanceof Error ? e.message : msg('CredentialManager.m0074'));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="settings-hint">{msg('CredentialManager.m0075')}</p>;
  const saved = providers
    .flatMap(provider => (lists[provider.id]?.profiles ?? []).map(profile => ({ provider, profile })))
    .sort((a, b) => Number(b.profile.is_default) - Number(a.profile.is_default));
  return (
    <div className="cred-manager">
      <p className="settings-hint">{kind === "editing" ? msg('CredentialManager.m0076') : msg('CredentialManager.m0077')}{' '}{msg('review.defaultConfiguration')}</p>
      {error && <div className="form-error" role="alert">{uiMessage(error)}<button type="button" className="cred-btn" disabled={Boolean(busy)} onClick={() => void load()}>{msg('CredentialManager.m0080')}</button></div>}
      <fieldset className="cred-manager__groups" disabled={Boolean(busy)}>
        {saved.length === 0 && <p className="settings-hint">{msg('CredentialManager.m0081')}</p>}
        {saved.map(({ provider, profile }) => (
          <ProfileCard key={`${provider.id}:${profile.id}`} actionName={actionName}
            servicePath={kind === "editing" ? `${base}/${provider.id}` : undefined}
            providerName={lists[provider.id].provider_name} experimental={Boolean(lists[provider.id].experimental)}
            profile={profile} fields={lists[provider.id].fields} view={views[profile.id]} busy={busy === profile.id}
            onReveal={fieldKey => reveal(provider.id, profile.id, fieldKey)}
            onStartEdit={() => startEdit(provider.id, profile.id)} onCancelEdit={() => cancelEdit(profile.id)}
            onSaveEdit={() => saveEdit(provider.id, profile.id)} onSetDefault={() => setDefault(provider.id, profile.id)}
            onDelete={() => remove(provider.id, profile.id)} setView={setView} />
        ))}
        {addingFor !== null ? (
          <section className="cred-add-panel">
            <label className="field"><span>{msg('CredentialManager.m0082')}</span>
              <select aria-label={msg('CredentialManager.m0083')} value={addingFor} onChange={event => {
                const id = event.target.value;
                if (id) startAdd(id, lists[id]);
                else { setAddingFor(""); setNewValues({}); }
              }}>
                <option value="">{msg('CredentialManager.m0084')}</option>
                {providers.map(provider => <option key={provider.id} value={provider.id}>{serviceText(lists[provider.id]?.provider_name ?? provider.name)}</option>)}
              </select>
            </label>
            {addingFor && lists[addingFor] ? <>
              {addingFor === "openai_compatible" && <p className="settings-hint">{msg('CredentialManager.m0085')}</p>}
              <AddCard key={addingFor} servicePath={kind === "editing" ? `${base}/${addingFor}` : undefined} fields={lists[addingFor].fields} name={newName} setName={setNewName}
                values={newValues} setValues={setNewValues} visible={newVisible} setVisible={setNewVisible}
                busy={Boolean(busy)} onCancel={() => { setAddingFor(null); setNewValues({}); setNewVisible({}); }}
                onSave={() => saveAdd(addingFor)} />
            </> : <button type="button" className="cred-btn" onClick={() => setAddingFor(null)}>{msg('CredentialManager.m0086')}</button>}
          </section>
        ) : <button type="button" className="cred-add-btn" onClick={() => setAddingFor("")}>{msg('CredentialManager.m0087')}</button>}
      </fieldset>
    </div>
  );
}

function ProfileCard({
  actionName,
  servicePath,
  profile,
  fields,
  view,
  busy,
  providerName,
  experimental,
  onReveal,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onSetDefault,
  onDelete,
  setView,
}: {
  actionName: string;
  servicePath?: string;
  providerName: string;
  experimental: boolean;
  profile: CredentialProfile;
  fields: CredentialField[];
  view?: ProfileView;
  busy: boolean;
  onReveal: (fieldKey: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  setView: (id: string, patch: Partial<ProfileView>) => void;
}) {
  useInterfaceLanguage();
  const isEditing = Boolean(view?.editing);
  const loaded = Boolean(view && Object.keys(view.values).length > 0);

  const toggleVisibility = async (fieldKey: string) => {
    // 未拉取过真实值时，点眼睛 = 拉取并直接显示（仅首次需要请求后端）。
    if (!loaded) {
      await onReveal(fieldKey);
      return;
    }
    // 已拉取后，眼睛在查看态与编辑态都可自由切换显隐。
    const v = view;
    if (!v) return;
    setView(profile.id, {
      visible: { ...v.visible, [fieldKey]: !v.visible[fieldKey] },
    });
  };

  return (
    <div className={`cred-profile${profile.is_default ? " cred-profile--default" : ""}`}>
      <div className="cred-profile__head">
        <span className="cred-profile__name">
          {isEditing ? (
            <input
              className="cred-profile__name-edit"
              value={view?.values.__name__ ?? profile.name}
              placeholder={msg('CredentialManager.m0088')}
              onChange={(e) =>
                setView(profile.id, {
                  values: { ...(view?.values ?? {}), __name__: e.target.value },
                })
              }
            />
          ) : (
            profile.name
          )}
        </span>
        {profile.is_default ? (
          <span className="tag tag--active" title={msg('CredentialManager.m0089', { v0: actionName })}>{msg('CredentialManager.m0090')}</span>
        ) : null}
      </div>
      <p className="cred-profile__summary">{providerName}{profile.public_values?.model ? ` · ${profile.public_values.model}` : ""}{experimental ? msg('CredentialManager.m0091') : ""}</p>

      {isEditing && <CredentialFields fields={fields} values={view?.values ?? {}} visible={view?.visible ?? {}}
        servicePath={servicePath} onToggle={toggleVisibility}
        onChange={(key, value) => setView(profile.id, { values: { ...view?.values, [key]: value } })} />}


      <div className="cred-profile__actions">
        {isEditing ? (
          <>
            <button type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={onSaveEdit}>
              {msg('CredentialManager.m0092')}</button>
            <button type="button" className="cred-btn" disabled={busy} onClick={onCancelEdit}>
              {msg('CredentialManager.m0093')}</button>
          </>
        ) : (
          <>
            <button type="button" className="cred-btn" disabled={busy} onClick={onStartEdit}>
              {msg('CredentialManager.m0094')}</button>
            {!profile.is_default ? (
              <button
                type="button"
                className="cred-btn cred-btn--default"
                disabled={busy}
                onClick={onSetDefault}
                title={msg('CredentialManager.m0095', { v0: actionName })}
              >
                {msg('CredentialManager.m0096')}</button>
            ) : null}
            <button type="button" className="cred-btn cred-btn--danger" disabled={busy} onClick={onDelete}>
              {msg('CredentialManager.m0097')}</button>
          </>
        )}
      </div>
    </div>
  );
}

function AddCard({
  servicePath,
  fields,
  name,
  setName,
  values,
  setValues,
  visible,
  setVisible,
  busy,
  onCancel,
  onSave,
}: {
  servicePath?: string;
  fields: CredentialField[];
  name: string;
  setName: (v: string) => void;
  values: Record<string, string>;
  setValues: (v: Record<string, string>) => void;
  visible: Record<string, boolean>;
  setVisible: (v: Record<string, boolean>) => void;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  useInterfaceLanguage();
  return (
    <div className="cred-profile cred-profile--add">
      <input
        className="cred-profile__name-edit"
        value={name}
        aria-label={msg('CredentialManager.m0098')}
        placeholder={msg('CredentialManager.m0099')}
        onChange={(e) => setName(e.target.value)}
      />
      <CredentialFields fields={fields} values={values} visible={visible} servicePath={servicePath}
        onToggle={key => setVisible({ ...visible, [key]: !visible[key] })}
        onChange={(key, value) => setValues({ ...values, [key]: value })} />
      <div className="cred-profile__actions">
        <button type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={onSave}>
          {msg('CredentialManager.m0100')}</button>
        <button type="button" className="cred-btn" disabled={busy} onClick={onCancel}>
          {msg('CredentialManager.m0101')}</button>
      </div>
    </div>
  );
}

export function CredentialFields({ fields, values, visible, onChange, onToggle, servicePath }: {
  fields: CredentialField[]; values: Record<string, string>; visible: Record<string, boolean>;
  onChange: (key: string, value: string) => void; onToggle: (key: string) => void; servicePath?: string;
}) {
  useInterfaceLanguage();
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const signature = JSON.stringify(stripName(values));
  const current = useRef(signature);
  useLayoutEffect(() => { current.current = signature; }, [signature]);
  const [noticeSignature, setNoticeSignature] = useState(signature);
  const [modelEndpoint, setModelEndpoint] = useState("");
  const endpoint = `${values.base_url ?? ""}|${values.api_key ?? ""}`;

  const request = async (action: "models" | "test") => {
    setBusy(true); setNotice(""); setNoticeSignature(signature); setFailed(false);
    try {
      const response = await fetch(`${servicePath}/${action}`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: stripName(values) }),
        signal: AbortSignal.timeout(action === "test" ? 195000 : 25000) });
      await credentialResponse(response);
      const data = await response.json() as { models?: string[] };
      if (current.current !== signature) return;
      if (action === "models") {
        setModels(data.models ?? []);setModelEndpoint(endpoint);
        setNotice(data.models?.length ? msg('CredentialManager.m0102', { v0: data.models.length }) : msg('CredentialManager.m0103'));
      } else setNotice(msg('CredentialManager.m0104'));
    } catch (error) {
      if (current.current !== signature) return;
      setFailed(true); setNotice(error instanceof Error ? error.message : msg('CredentialManager.m0105'));
    } finally { setBusy(false); }
  };
  const renderField = (field: CredentialField) => <FieldInput key={field.key}
    field={field.key === "model" ? { ...field, options: [...new Set([...(field.options ?? []), ...(modelEndpoint===endpoint?models:[])])] } : field}
    value={values[field.key] ?? ""} visible={Boolean(visible[field.key])}
    onToggle={() => onToggle(field.key)} onChange={value => onChange(field.key, value)} disabled={busy} />;
  return <div className="cred-profile__fields">
    {fields.filter(field => !field.advanced).map(renderField)}
    {fields.some(field => field.advanced) && <details className="cred-advanced">
      <summary>{msg('CredentialManager.m0106')}</summary><div className="cred-profile__fields">{fields.filter(field => field.advanced).map(renderField)}</div>
    </details>}
    {servicePath && <>
      <div className="cred-profile__actions">
        <button type="button" className="cred-btn" disabled={busy} onClick={() => void request("models")}>{msg('CredentialManager.m0107')}</button>
        <button type="button" className="cred-btn" disabled={busy || !values.model?.trim()} onClick={() => void request("test")}>{msg('CredentialManager.m0108')}</button>
        {busy && <span className="settings-hint" role="status">{msg('CredentialManager.m0109')}</span>}
      </div>
      <small className="cred-field__hint">{msg('CredentialManager.m0110')}</small>
      {noticeSignature===signature && notice && <p className={failed ? "form-error" : "settings-hint"} role={failed ? "alert" : "status"}>{uiMessage(notice)}</p>}
    </>}
  </div>;
}

function stripName(values: Record<string, string>): Record<string, string> {
  const next = { ...values };
  delete next.__name__;
  return next;
}

function EyeOpen() {
  useInterfaceLanguage();
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeClosed() {
  useInterfaceLanguage();
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 1 12s4 7 11 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
