import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { ProcessingNotice } from './ProcessingNotice';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { collectMaterialFiles, prepareMaterials, type ImportMaterial } from '../lib/materialImport';
import { importProjectMaterials, type OpenProject } from '../lib/projectStore';
interface Props { project: OpenProject; interviewId?: string; onDone: (project: OpenProject) => void; onCancel: () => void; onBusyChange?: (busy: boolean) => void }
type Pickers = { showOpenFilePicker(options: { multiple: boolean; types?: { description: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle[]>; showDirectoryPicker(options: { mode: string }): Promise<FileSystemDirectoryHandle> };
export function AudioPreview({ item, onDuration }: { item: ImportMaterial; onDuration: (duration: number) => void }) {
  useInterfaceLanguage();
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false; let objectUrl = '';
    void item.handle.getFile().then(file => {
      if (!disposed) { objectUrl = URL.createObjectURL(file); setUrl(objectUrl); }
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item.handle]);
  return failed ? <small>{msg('MaterialImport.m0556')}</small> : <audio aria-label={msg('MaterialImport.m0557', { v0: item.name })} controls controlsList="nodownload noplaybackrate" preload="metadata" src={url || undefined} onLoadedMetadata={e => onDuration(e.currentTarget.duration)} onError={() => setFailed(true)} />;
}
function MaterialIcon({ kind }: { kind: 'audio' | 'transcript' | 'session' | 'ignore' | 'add' }) {
  useInterfaceLanguage();
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'ignore' && <><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>}
    {kind === 'audio' && <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>}
    {kind === 'transcript' && <><path d="M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 16h6" /></>}
    {kind === 'session' && <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 17h2" /></>}
    {kind === 'add' && <path d="M12 5v14M5 12h14" />}
  </svg>;
}
export function PreviewDialog({ item, onClose }: { item: ImportMaterial; onClose: () => void }) {
  useInterfaceLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return createPortal(<dialog ref={dialog} className="material-preview-dialog" aria-label={msg('MaterialImport.m0558', { v0: item.name })} onCancel={onClose}>
    <header className="dialog-header"><div><p className="section-label">{msg('MaterialImport.m0559')}</p><h2>{item.name}</h2></div><button type="button" aria-label={msg('MaterialImport.m0560')} title={msg('MaterialImport.m0561')} onClick={onClose}>×</button></header>
    <div className="material-preview-body" tabIndex={0}>{item.transcript?.segments.map(segment => <p key={segment.id}>{segment.text}</p>)}</div>
  </dialog>, document.body);
}
function ManuscriptPreview({ item }: { item: ImportMaterial }) {
  useInterfaceLanguage();
  const [open, setOpen] = useState(false);
  return <><button type="button" className="material-preview-trigger" onClick={() => setOpen(true)}>{msg('MaterialImport.m0562')}</button>{open && <PreviewDialog item={item} onClose={() => setOpen(false)} />}</>;
}
export function MaterialImport({ project, interviewId, onDone, onCancel, onBusyChange }: Props) {
  useInterfaceLanguage();
  const [items, setItems] = useState<ImportMaterial[]>([]);
  const [bulkGroup, setBulkGroup] = useState('');
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [storage, setStorage] = useState<'copy' | 'reference'>('copy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const interview = project.data.interviews.find(i => i.id === interviewId);
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try { await work(); } catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof Error ? e.message : msg('MaterialImport.m0563')); }
    finally { inFlight.current = false; setBusy(false); onBusyChange?.(false); }
  };
  const pick = (folder: boolean) => run(async () => {
    const picker = window as unknown as Pickers;
    const files = folder ? await collectMaterialFiles(await picker.showDirectoryPicker({ mode: 'read' })) : (await picker.showOpenFilePicker({ multiple: true })).map(handle => ({ handle }));
    if (!files.length) throw new Error(msg('MaterialImport.m0564'));
    const added = await prepareMaterials(files);
    setItems(previous => [...previous, ...added.map(item => interview ? { ...item, group: interview.title } : { ...item, group: '' })]);
  });
  const pickTranscripts = (audioItem: ImportMaterial) => run(async () => {
    const handles = await (window as unknown as Pickers).showOpenFilePicker({ multiple: true, types: [{ description: msg('MaterialImport.m0565'), accept: { 'text/plain': ['.txt', '.srt', '.vtt'], 'application/json': ['.json'], 'application/msword': ['.doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } }] });
    if (!handles.length) return;
    const selected: ImportMaterial[] = [];
    for (const handle of handles) {
      let known: ImportMaterial | undefined;
      for (const candidate of [...items, ...selected]) {
        if (candidate.handle === handle || (handle.isSameEntry && await handle.isSameEntry(candidate.handle))) { known = candidate; break; }
      }
      if (known?.kind === 'audio') throw new Error(msg('MaterialImport.m0566'));
      if (known?.audioId && known.audioId !== audioItem.id) throw new Error(msg('MaterialImport.m0567', { v0: known.name }));
      const material = known ?? (await prepareMaterials([{ handle }]))[0];
      if (!material || material.kind !== 'manuscript') throw new Error(msg('MaterialImport.m0568'));
      if (!selected.some(i => i.id === material.id)) selected.push({ ...material, audioId: audioItem.id, group: audioItem.group });
    }
    setItems(previous => [...previous.filter(i => !selected.some(m => m.id === i.id)), ...selected]);
  });
  const audio = items.filter(i => i.kind === 'audio');
  const groupCount = new Set(items.map(i => i.group.trim()).filter(Boolean)).size;
  const patch = (id: string, changes: Partial<ImportMaterial>) => setItems(previous => previous.map(item => {
    if (item.id === id) return { ...item, ...changes };
    if (changes.group !== undefined && item.audioId === id) return { ...item, group: changes.group };
    return item;
  }));
  return <section className="material-import" aria-label={msg('MaterialImport.m0569')} aria-busy={busy}>
    <h2>{items.length ? msg('MaterialImport.m0570') : msg('MaterialImport.m0571')}</h2>
    <p className="settings-hint">{msg('MaterialImport.m0572')}</p>
    <div className="project-actions"><button className="button button--primary" disabled={busy} onClick={() => void pick(false)}>{msg('MaterialImport.m0573')}</button><button className="button button--secondary" disabled={busy} onClick={() => void pick(true)}>{msg('MaterialImport.m0574')}</button></div>
    <p className="settings-hint">{msg('MaterialImport.m0575')}</p>
    {error && <p role="alert" className="form-error">{uiMessage(error)}</p>}
    {busy && <ProcessingNotice>{msg('MaterialImport.m0576')}</ProcessingNotice>}
    {!!items.length && <>
      <datalist id="material-interviews">{Array.from(new Set([...project.data.interviews.map(i => i.title), ...items.map(i => i.group)])).map(group => <option key={group} value={group} />)}</datalist>
      {!!audio.length && <section className="material-group" aria-label={msg('MaterialImport.m0577')}>
        <div className="material-group-heading"><h3 className="material-icon-label"><MaterialIcon kind="audio" />{msg('MaterialImport.m0578')}<span>{audio.length}</span></h3><p className="settings-hint">{msg('MaterialImport.m0579')}</p></div>
        {!interview && audio.length > 1 && <details className="material-bulk"><summary>{msg('MaterialImport.m0580')}</summary><div className="project-actions"><input aria-label={msg('MaterialImport.m0581')} list="material-interviews" placeholder={msg('MaterialImport.m0582')} value={bulkGroup} disabled={busy} onChange={e => setBulkGroup(e.target.value)} /><button className="cred-btn" disabled={busy || !bulkGroup.trim()} onClick={() => setItems(previous => previous.map(i => i.kind === 'audio' || i.audioId ? { ...i, group: bulkGroup.trim() } : i))}>{msg('MaterialImport.m0583')}</button></div></details>}
        <div className="material-list">{audio.map(item => {
          const linkedItems = items.filter(m => m.audioId === item.id);
          return <article className="material-audio" key={item.id}>
            <div className="material-row-heading"><strong className="material-icon-label"><MaterialIcon kind={item.kind === 'audio' ? 'audio' : 'transcript'} />{item.name}</strong><button className="material-remove" title={msg('MaterialImport.m0584')} disabled={busy} aria-label={msg('MaterialImport.m0585', { v0: item.name })} onClick={() => setItems(previous => previous.filter(i => i.id !== item.id).map(i => i.audioId === item.id ? { ...i, audioId: '' } : i))}><MaterialIcon kind="ignore" /></button></div>
            <div className="material-fields"><label className="field"><span className="material-icon-label"><MaterialIcon kind="session" />{msg('MaterialImport.m0586')}</span><input list="material-interviews" placeholder={msg('MaterialImport.m0587')} aria-label={msg('MaterialImport.m0588', { v0: item.name })} value={item.group} disabled={busy || !!interview} onChange={e => patch(item.id, { group: e.target.value })} /></label>
            </div>
            <AudioPreview item={item} onDuration={duration => setDurations(previous => previous[item.id] === duration ? previous : { ...previous, [item.id]: duration })} />
            <section className="material-transcripts" aria-label={msg('MaterialImport.m0589', { v0: item.name })}><div className="material-row-heading"><span className="material-kind-label"><MaterialIcon kind="transcript" />{msg('MaterialImport.m0590')}{linkedItems.length ? ` · ${linkedItems.length}` : ''}</span><button className="cred-btn material-icon-label" disabled={busy} onClick={() => void pickTranscripts(item)}><MaterialIcon kind="add" />{msg('MaterialImport.m0591')}</button></div>
            {!linkedItems.length && <p className="settings-hint">{msg('MaterialImport.m0592')}</p>}
            {linkedItems.map(linked => <div className="material-linked" key={linked.id}><div className="material-row-heading"><strong className="material-icon-label"><MaterialIcon kind="transcript" />{linked.name}</strong><button className="cred-btn" disabled={busy} onClick={() => patch(linked.id, { audioId: '' })}>{msg('MaterialImport.m0593')}</button></div><p className="settings-hint">{linked.transcript?.timeAligned === false ? msg('MaterialImport.m0594') : msg('MaterialImport.m0595')}</p>{linked.transcript?.timeAligned !== false && linked.transcript?.segments.some(s => s.end > durations[item.id] + 2) && <p role="status" className="form-error">{msg('MaterialImport.m0596')}</p>}<ManuscriptPreview item={linked} /></div>)}
            </section>
          </article>;
        })}</div>
      </section>}
      <section className="material-group" aria-label={msg('MaterialImport.m0597')}><div className="material-group-heading"><h3 className="material-icon-label"><MaterialIcon kind="transcript" />{msg('MaterialImport.m0598')}<span>{items.filter(i => i.kind === 'manuscript' && !i.audioId).length}</span></h3><p className="settings-hint">{msg('MaterialImport.m0599')}</p></div>
        <div className="material-list">{items.filter(i => i.kind === 'manuscript' && !i.audioId).map(item => <article className="material-document" key={item.id}>
          <div className="material-row-heading"><div className="material-name"><strong className="material-icon-label"><MaterialIcon kind={item.kind === 'audio' ? 'audio' : 'transcript'} />{item.name}</strong><small>{item.transcript?.timeAligned === false ? msg('MaterialImport.m0600') : msg('MaterialImport.m0601')}</small></div><button className="material-remove" title={msg('MaterialImport.m0602')} disabled={busy} aria-label={msg('MaterialImport.m0603', { v0: item.name })} onClick={() => setItems(previous => previous.filter(i => i.id !== item.id))}><MaterialIcon kind="ignore" /></button></div>
          <label className="field"><span className="material-icon-label"><MaterialIcon kind="session" />{msg('MaterialImport.m0604')}</span><input list="material-interviews" placeholder={msg('MaterialImport.m0605')} aria-label={msg('MaterialImport.m0606', { v0: item.name })} value={item.group} disabled={busy || !!interview} onChange={e => patch(item.id, { group: e.target.value })} /></label><ManuscriptPreview item={item} />
        </article>)}</div>
        {!items.some(i => i.kind === 'manuscript' && !i.audioId) && <p className="settings-hint">{items.some(i => i.kind === 'manuscript') ? msg('MaterialImport.m0607') : msg('MaterialImport.m0608')}</p>}
      </section>
      {!!audio.length && <label className="field"><span>{msg('MaterialImport.m0609')}</span><select value={storage} disabled={busy} onChange={e => setStorage(e.target.value as 'copy' | 'reference')}><option value="copy">{msg('MaterialImport.m0610')}</option><option value="reference">{msg('MaterialImport.m0611')}</option></select></label>}
      {audio.length > 0 && storage === 'reference' && <p className="settings-hint">{msg('MaterialImport.m0612')}</p>}
      <p className="settings-hint">{msg('MaterialImport.m0613')}</p>
    </>}
    <div className="project-actions">{!!items.length && <button className="button button--primary" disabled={busy || !items.length || items.some(i => !i.group.trim())} onClick={() => void run(async () => onDone(await importProjectMaterials(project, items, storage, interviewId)))}>{interview ? msg('MaterialImport.m0614') : groupCount ? msg('MaterialImport.m0615', { v0: groupCount }) : msg('MaterialImport.m0616')}</button>}<button className="button button--secondary" disabled={busy} onClick={onCancel}>{items.length ? msg('MaterialImport.m0617') : msg('MaterialImport.m0618')}</button></div>
  </section>;
}
