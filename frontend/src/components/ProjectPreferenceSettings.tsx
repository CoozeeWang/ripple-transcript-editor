import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { loadBooleanPreference, saveBooleanPreference } from '../lib/preferences';
import { FIXED_PROJECT_LOCATION, OPEN_LAST_PROJECT, loadProjectLocation, saveProjectLocation } from '../lib/projectPreferences';

export function ProjectPreferenceSettings() {
  useInterfaceLanguage();
  const [openLast, setOpenLast] = useState(() => loadBooleanPreference(OPEN_LAST_PROJECT, false));
  const [fixed, setFixed] = useState(() => loadBooleanPreference(FIXED_PROJECT_LOCATION, false));
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadProjectLocation(fixed).then(handle => { if (!cancelled) setLocation(handle?.name ?? ''); })
      .catch(() => { if (!cancelled) setError(msg('ProjectPreferenceSettings.m0769')); });
    return () => { cancelled = true; };
  }, [fixed]);
  const choose = async () => {
    setBusy(true); setError('');
    try {
      const picker = window as unknown as { showDirectoryPicker: (options: { mode: string }) => Promise<FileSystemDirectoryHandle> };
      const handle = await picker.showDirectoryPicker({ mode: 'readwrite' });
      await saveProjectLocation(handle, true);
      setLocation(handle.name);
    } catch (e) { if ((e as Error).name !== 'AbortError') setError(msg('ProjectPreferenceSettings.m0770')); }
    finally { setBusy(false); }
  };
  return <>
    <section className="settings-block">
      <div className="settings-heading"><div><h3>{msg('ProjectPreferenceSettings.m0771')}</h3><p>{msg('ProjectPreferenceSettings.m0772')}</p></div></div>
      <div className="settings-options">{[[false, msg('ProjectPreferenceSettings.m0773')], [true, msg('ProjectPreferenceSettings.m0774')]].map(([value, label]) => <label className="settings-option" key={String(value)}>
        <input type="radio" name="project-startup" checked={openLast === value} onChange={() => { setOpenLast(Boolean(value)); saveBooleanPreference(OPEN_LAST_PROJECT, Boolean(value)); }}/><span>{label}</span>
      </label>)}</div>
    </section>
    <section className="settings-block">
      <div className="settings-heading"><div><h3>{msg('ProjectPreferenceSettings.m0775')}</h3><p>{msg('ProjectPreferenceSettings.m0776')}</p></div></div>
      <div className="settings-options">
        <label className="settings-option"><input type="radio" name="project-location" disabled={busy} checked={!fixed} onChange={() => { setFixed(false); setLocation(''); setError(''); saveBooleanPreference(FIXED_PROJECT_LOCATION, false); }}/><span>{msg('ProjectPreferenceSettings.m0777')}</span></label>
        <div className="settings-location-option">
          <label className="settings-option"><input type="radio" name="project-location" disabled={busy} checked={fixed} onChange={() => { setFixed(true); setLocation(''); setError(''); saveBooleanPreference(FIXED_PROJECT_LOCATION, true); }}/><span>{msg('ProjectPreferenceSettings.m0778')}</span></label>
          {fixed && <div className="settings-location-control"><span className={`settings-location-value${location ? ' settings-location-value--selected' : ''}`} title={location ? msg('ProjectPreferenceSettings.m0779', { v0: location }) : undefined}>{location || msg('ProjectPreferenceSettings.m0780')}</span><button className="cred-btn" disabled={busy} onClick={() => void choose()}>{msg('ProjectPreferenceSettings.m0781')}</button></div>}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{uiMessage(error)}</p>}
    </section>
  </>;
}
