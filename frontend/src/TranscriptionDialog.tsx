import { serviceText } from './i18n/serviceText';
import { msg, useInterfaceLanguage } from './i18n';
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useDismissable } from "./useDismissable";
import type { CredentialListView, ProviderInfo, TranscriptionOptions } from "./types";

interface TranscriptionDialogProps {
  providers: ProviderInfo[];
  /** 全局默认引擎 id（来自后端 /api/credentials/default），用于标注「默认」徽标。 */
  defaultProviderId: string | null;
  selectedProviderId: string;
  onSelectProvider: (id: string) => void;
  hasAudio: boolean;
  audioFilename: string;
  busy: boolean;
  onClose: () => void;
  onStart: (options: TranscriptionOptions, providerId: string) => Promise<void>;
}

export function TranscriptionDialog({
  providers,
  selectedProviderId,
  onSelectProvider,
  hasAudio,
  audioFilename,
  busy,
  onClose,
  onStart,
}: TranscriptionDialogProps) {
  useInterfaceLanguage();
  const [error, setError] = useState<{ message: string; code?: string; raw?: string } | null>(null);

  function handleFailure(err: unknown) {
    if (err instanceof Error) {
      const raw = (err as { raw?: unknown }).raw;
      const code = (err as { code?: unknown }).code;
      setError({
        message: err.message,
        code: typeof code === "string" ? code : undefined,
        raw: typeof raw === "string" ? raw : undefined,
      });
      return;
    }
    setError({ message: msg('TranscriptionDialog.m0111') });
  }

  async function copyErrorDetail(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* 忽略剪贴板不可用的情况 */
    }
  }
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [reloadProfiles, setReloadProfiles] = useState(0);
  const [languageCode, setLanguageCode] = useState("zho");
  const [speakerCount, setSpeakerCount] = useState("");
  const [diarize, setDiarize] = useState(true);
  const [tagAudioEvents, setTagAudioEvents] = useState(true);
  // 全部 provider 的档案清单（用于展开态两段式展示），按 provider_id 索引。
  const [profileLists, setProfileLists] = useState<{
    providers: ProviderInfo[];
    lists: Record<string, CredentialListView>;
  } | null>(null);
  const profilesByProvider = profileLists?.providers === providers ? profileLists.lists : {};
  // 用户选定的具体档案 id（默认 = 当前 provider 的 active）。选择不同档案后转录时
  // 临时 activate，转录完成后还原原 active，不污染设置页的全局启用。
  const [requestedProfileId, setSelectedProfileId] = useState<string | null>(null);
  // 每个 provider 的「原 active id」，提交时临时切回。
  const originalActiveRef = useRef<Record<string, string | null>>({});
  const dialogRef = useRef<HTMLElement>(null);

  useDismissable(dialogRef, true, onClose);

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) ?? providers[0];
  const selectedList = selectedProvider ? profilesByProvider[selectedProvider.id] : undefined;
  const selectedProfileId = selectedList?.profiles.some(p => p.id === requestedProfileId)
    ? requestedProfileId : selectedList?.profiles.find(p => p.is_default)?.id ?? selectedList?.active_profile_id ?? selectedList?.profiles[0]?.id ?? null;
  const capabilities = selectedProvider?.capabilities;
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const configured = providers;
    let cancelled = false;
    Promise.all(
      configured.map(async (p) => {
        const r = await fetch(`/api/providers/${p.id}/credentials`);
        if (!r.ok) throw new Error(msg('TranscriptionDialog.m0112', { v0: serviceText(p.name) }));
        return [p.id, (await r.json()) as CredentialListView] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        const map: Record<string, CredentialListView> = {};
        const originalActive: Record<string, string | null> = {};
        for (const [pid, list] of entries) {
          map[pid] = list;
          originalActive[pid] = list.active_profile_id;
        }
        setProfileLists({ providers, lists: map });
        originalActiveRef.current = originalActive;
      })
      .catch(error => { if (!cancelled) { setProfileLoadFailed(true); handleFailure(error); } });
    return () => {
      cancelled = true;
    };
  }, [providers, reloadProfiles]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!selectedProvider || !selectedProfileId || submitting || busy) return;
    setSubmitting(true);
    const targetProfileId = selectedProfileId;
    const originalProfileId = originalActiveRef.current[selectedProvider.id];
    const shouldSwitch = targetProfileId && targetProfileId !== originalProfileId;
    try {
      // 临时激活用户选定的档案（不持久化偏好设置——转录完立刻切回原 active）
      if (shouldSwitch) {
        const r = await fetch(
          `/api/providers/${selectedProvider.id}/credentials/${targetProfileId}/activate`,
          { method: "POST" },
        );
        if (!r.ok) throw new Error(msg('TranscriptionDialog.m0113'));
      }
      await onStart(
        {
          language_code: capabilities?.language_selection ? languageCode || null : null,
          num_speakers: capabilities?.speaker_count_hint
            ? speakerCount
              ? Number(speakerCount)
              : null
            : null,
          diarize: capabilities?.diarization ? diarize : false,
          tag_audio_events: capabilities?.audio_events ? tagAudioEvents : false,
          timestamps_granularity: "word",
        },
        selectedProvider.id,
      );
    } catch (startError) {
      handleFailure(startError);
    } finally {
      setSubmitting(false);
      // 无论成功失败，都把 active 还原到转录前的状态（不污染设置页的全局默认）
      if (shouldSwitch && originalProfileId) {
        try {
          await fetch(
            `/api/providers/${selectedProvider.id}/credentials/${originalProfileId}/activate`,
            { method: "POST" },
          );
        } catch {
          /* 还原失败不阻塞 UI；下次进转录弹窗会重新拉取 */
        }
      }
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="interview-dialog transcription-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcription-dialog-title"
      >
        <header className="dialog-header">
          <div>
            <p className="section-label">{(selectedProvider ? serviceText(selectedProvider.name) : undefined) ?? msg('TranscriptionDialog.m0114')}</p>
            <h2 id="transcription-dialog-title">{msg('TranscriptionDialog.m0115')}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={msg('TranscriptionDialog.m0116')}>×</button>
        </header>

        <form onSubmit={(event) => void submit(event)}>
          <section className="settings-block">
            <label className="field"><span>{msg('TranscriptionDialog.m0117')}</span>
              <select aria-label={msg('TranscriptionDialog.m0118')} disabled={busy || submitting || !profileLists}
                value={selectedProfileId && selectedProvider ? `${selectedProvider.id}:${selectedProfileId}` : ""}
                onChange={event => {
                  const [provider, profile] = event.target.value.split(":");
                  onSelectProvider(provider); setSelectedProfileId(profile);
                }}>
                <option value="" disabled>{profileLists ? msg('TranscriptionDialog.m0119') : profileLoadFailed ? msg('TranscriptionDialog.m0120') : msg('TranscriptionDialog.m0121')}</option>
                {providers.flatMap(provider => (profilesByProvider[provider.id]?.profiles ?? []).map(profile => (
                  <option key={`${provider.id}:${profile.id}`} value={`${provider.id}:${profile.id}`}>
                    {profile.is_default ? msg('extra.defaultProfile', { name: `${profile.name} · ${serviceText(provider.name)}${profile.public_values?.model ? ` · ${profile.public_values.model}` : ''}` }) : `${profile.name} · ${serviceText(provider.name)}${profile.public_values?.model ? ` · ${profile.public_values.model}` : ''}`}
                  </option>
                )))}
              </select>
            </label>
            {profileLists && !providers.some(provider => profilesByProvider[provider.id]?.profiles.length) &&
              <p className="settings-hint">{msg('TranscriptionDialog.m0123')}</p>}
          </section>

          <section className="settings-block">
            <div className="settings-heading">
              <div>
                <h3>{msg('TranscriptionDialog.m0124')}</h3>
                <p className="settings-hint">{msg('TranscriptionDialog.m0125')}</p>
                <p>{hasAudio ? msg('TranscriptionDialog.m0126', { v0: audioFilename }) : msg('TranscriptionDialog.m0127')}</p>
              </div>
              <span className={hasAudio ? "status-pill status-pill--ok" : "status-pill"}>
                {hasAudio ? msg('TranscriptionDialog.m0128') : msg('TranscriptionDialog.m0129')}
              </span>
            </div>
            <div className="form-grid">
              {capabilities?.language_selection && (
                <label className="field">
                  <span>{msg('TranscriptionDialog.m0130')}</span>
                  <select value={languageCode} onChange={(event) => setLanguageCode(event.target.value)}>
                    <option value="zho">{msg('TranscriptionDialog.m0131')}</option>
                    <option value="">{msg('TranscriptionDialog.m0132')}</option>
                    <option value="yue">{msg('TranscriptionDialog.m0133')}</option>
                    <option value="eng">{msg('TranscriptionDialog.m0134')}</option>
                  </select>
                </label>
              )}
              {capabilities?.speaker_count_hint && (
                <label className="field">
                  <span>{msg('TranscriptionDialog.m0135')}</span>
                  <input
                    type="number"
                    min="1"
                    max="32"
                    value={speakerCount}
                    onChange={(event) => setSpeakerCount(event.target.value)}
                    placeholder={msg('TranscriptionDialog.m0136')}
                  />
                </label>
              )}
            </div>
            <div className="option-list">
              {capabilities?.diarization && (
                <label>
                  <input type="checkbox" checked={diarize} onChange={(event) => setDiarize(event.target.checked)} />
                  <span><strong>{msg('TranscriptionDialog.m0137')}</strong><small>{msg('TranscriptionDialog.m0138')}</small></span>
                </label>
              )}
              {capabilities?.audio_events && (
                <label>
                  <input type="checkbox" checked={tagAudioEvents} onChange={(event) => setTagAudioEvents(event.target.checked)} />
                  <span><strong>{msg('TranscriptionDialog.m0139')}</strong><small>{msg('TranscriptionDialog.m0140')}</small></span>
                </label>
              )}
            </div>
          </section>

          {error && (
            <div className="form-error-block" role="alert">
              <p className="form-error">{error.message}</p>
              {profileLoadFailed && <button type="button" className="button button--secondary" onClick={() => { setError(null); setProfileLoadFailed(false); setReloadProfiles(value => value + 1); }}>{msg('TranscriptionDialog.m0141')}</button>}
              {error.code && <p className="form-error-code">{msg('TranscriptionDialog.m0142')}{error.code}</p>}
              {error.raw && (
                <div className="form-error-raw">
                  <div className="form-error-raw-head">
                    <span>{msg('TranscriptionDialog.m0143')}</span>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => copyErrorDetail(error.raw ?? "")}
                    >
                      {msg('TranscriptionDialog.m0144')}</button>
                  </div>
                  <pre>{error.raw}</pre>
                </div>
              )}
            </div>
          )}
          <footer className="dialog-actions">
            <button className="button button--secondary" type="button" onClick={onClose}>{msg('TranscriptionDialog.m0145')}</button>
            <button
              className="button button--primary"
              type="submit"
              disabled={!selectedProfileId || !hasAudio || busy || submitting}
            >
              {busy || submitting ? msg('TranscriptionDialog.m0146') : msg('TranscriptionDialog.m0147')}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
