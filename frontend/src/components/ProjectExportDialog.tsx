import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { trapDialogFocus } from '../lib/dialogFocus';
import { useEffect, useRef, useState } from 'react';
import { defaultMetadata, readManifest, readModelEdit, readModelOriginal, sanitizeForFilename } from '../localStore';
import { recordingDirectory, checkedMediaFile, referenceAudioNotice, savePortableProject, type OpenProject } from '../lib/projectStore';
import { exportFormats, buildExportModel, canExportSubtitles, downloadBlob, renderPdfHtml, transcriptBlob, type ExportFormat } from '../lib/export';
import { ProjectIcon } from './ProjectIcon';
import type { InterviewMetadata, Transcript } from '../types';
type Entry = { id: string; session: string; recording: string; document?: string; name: string; versionLabel?: string; current: boolean; reference?: string; audio?: () => Promise<File>; transcript?: Transcript; metadata?: InterviewMetadata; engine?: string };
function audioExportName(name: string, file: string) {
  const extension = file.match(/\.[^.]+$/)?.[0] ?? '';
  const stem = name.replace(/\.(m4a|mp3|wav|aac|flac|ogg|opus|aiff?|wma|mp4|webm)$/i, '');
  return stem + extension;
}
export function ProjectExportDialog({ project, onClose }: { project: OpenProject; onClose: () => void }) {
  useInterfaceLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState('materials');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [formats, setFormats] = useState<Record<string, ExportFormat>>({});
  const [title, setTitle] = useState(msg('ProjectExportDialog.m0718', { v0: project.data.title }));
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    const modal = dialog.current;
    const previous = document.activeElement;
    modal?.showModal();
    return () => {
      if (modal?.open) modal.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows: Entry[] = [];
      for (const session of project.data.interviews) for (const recording of session.recordings) {
        const base = `${session.id}/${recording.id}`;
        if (recording.storage !== 'none') rows.push({ id: base, session: session.id, recording: recording.id, name: audioExportName(recording.name, recording.file || recording.name), current: true, reference: recording.storage === 'reference' ? referenceAudioNotice(recording,session.title) : undefined, audio: async () => checkedMediaFile(project, session.id, recording) });
        const dir = await recordingDirectory(project, session.id, recording);
        const manifest = await readManifest(dir, recording.file);
        if(recording.storage==='reference'){
          const audioRow=rows.find(e=>e.id===base)!;
          audioRow.reference=referenceAudioNotice(recording,session.title,(manifest?.models??[]).map(m=>m.label||m.sourceName||m.engine));
        }
        for (const model of manifest?.models ?? []) {
          const versions = [...(model.original ? [{ id: 'original', label: model.designatedOriginal ? msg('ProjectExportDialog.m0719') : msg('ProjectExportDialog.m0720') }] : []), ...model.edits.map((e, i) => ({ id: e.id, label: e.label || `v${i + 1}` }))];
          for (const version of versions.filter(v => v.id === (model.activeEditId || model.edits[0]?.id || 'original'))) {
            const data = version.id === 'original' ? await readModelOriginal(dir, recording.file, model.id) : await readModelEdit(dir, recording.file, model.id, version.id);
            if (!data) throw new Error(msg('ProjectExportDialog.m0721', { v0: model.label || recording.name }));
            rows.push({ id: `${base}/${model.id}/${version.id}`, session: session.id, recording: recording.id, document: `${base}/${model.id}`, name: model.label || model.sourceName || recording.name, versionLabel: version.label, current: version.id === (model.activeEditId || model.edits[0]?.id || 'original'), transcript: data.transcript, metadata: 'metadata' in data ? data.metadata as InterviewMetadata : { ...defaultMetadata(model.label || recording.name), ...session.metadata, ...manifest?.interviewDetails, title: manifest?.title || model.label || recording.name }, engine: model.engine });
          }
        }
      }
      if (!cancelled) { setEntries(rows); setSelected(new Set(rows.filter(e => e.current).map(e => e.id))); }
    })().catch(e => { if (!cancelled) { setLoadFailed(true); setError(e instanceof Error ? e.message : msg('ProjectExportDialog.m0722')); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project, loadAttempt]);
  const visibleEntries = entries.filter(e => e.current);
  const chosen = visibleEntries.filter(e => selected.has(e.id));
  const allSelected = chosen.length === visibleEntries.length;
  const entryFormat = (entry: Entry) => formats[entry.id] ?? 'docx';
  const invalidSubtitle = chosen.some(e => e.transcript && ['srt', 'vtt'].includes(entryFormat(e)) && !canExportSubtitles(e.transcript));
  const hasPdf = chosen.some(e => e.transcript && entryFormat(e) === 'pdf');
  const fileName = (entry: Entry) => entry.reference ? msg('ProjectExportDialog.m0723', { v0: entry.name }) : entry.audio ? entry.name : `${entry.name.replace(/\.(docx?|txt|srt|vtt|json|md|pdf)$/i, '')}.${entryFormat(entry)}`;
  const paths = new Map<string, string>();
  const used = new Set<string>();
  for (const entry of [...chosen].sort((a, b) => Number(b.current) - Number(a.current))) {
    // Only disambiguate real collisions; internal IDs and version labels never enter filenames.
    const base = sanitizeForFilename(fileName(entry));
    let name = base;
    let n = 2;
    while (used.has(`${entry.session}/${name}`.toLowerCase())) {
      const dot = base.lastIndexOf('.');
      name = dot > 0 ? `${base.slice(0, dot)} (${n++})${base.slice(dot)}` : `${base} (${n++})`;
    }
    used.add(`${entry.session}/${name}`.toLowerCase());
    paths.set(entry.id, name);
  }
  const toggle = (ids: string[], checked: boolean) => setSelected(old => { const next = new Set(old); for (const id of ids) if (checked) next.add(id); else next.delete(id); return next; });
  const exportFiles = async (kind = mode) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    let printWindow: Window | null = null;
    try {
      if (kind === 'project') {
        const parent = await (window as unknown as { showDirectoryPicker: (o: { mode: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' });
        const copy = await savePortableProject(project, parent, title);
        setNotice(msg('ProjectExportDialog.m0724', { v0: copy.directory.name }));
      } else {
        if (!chosen.length || invalidSubtitle) throw new Error(msg('ProjectExportDialog.m0725'));
        if (hasPdf) {
          printWindow = window.open('', '_blank');
          if (!printWindow) throw new Error(msg('ProjectExportDialog.m0726'));
          printWindow.document.body.textContent = msg('ProjectExportDialog.m0727');
        }
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        const pdf: string[] = [];
        let count = 0;
        const folders = new Map<string, string>();
        const usedFolders = new Set<string>();
        for (const session of project.data.interviews) {
          const base = sanitizeForFilename(session.title) || msg('ProjectExportDialog.m0728');
          let folder = base; let n = 2;
          while (usedFolders.has(folder.toLowerCase())) folder = `${base} (${n++})`;
          usedFolders.add(folder.toLowerCase()); folders.set(session.id, folder);
        }
        for (const entry of chosen) {
          const sessionIndex = project.data.interviews.findIndex(s => s.id === entry.session);
          const session = project.data.interviews[sessionIndex];
          const folder = folders.get(entry.session)!;
          const name = paths.get(entry.id)!;
          const format = entryFormat(entry);
          if (entry.reference) { zip.file(`${folder}/${name}`, new TextEncoder().encode(entry.reference)); count++; } else if (entry.audio) {
            const file = await entry.audio();
            zip.file(`${folder}/${name}`, await file.arrayBuffer()); count++;
          } else if (entry.transcript) {
            if (format === 'pdf') pdf.push(renderPdfHtml(buildExportModel(entry.transcript, { ...entry.metadata!, title: `${session.title} · ${entry.name}` })));
            else { zip.file(`${folder}/${name}`, await (await transcriptBlob(format, entry.transcript, entry.metadata ?? null, entry.engine)).arrayBuffer()); count++; }
          }
        }
        if (pdf.length && printWindow) {
          const first = pdf[0];
          const body = pdf.map(html => `<section class="export-document">${html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || ''}</section>`).join('');
          printWindow.document.open(); printWindow.document.write(first.replace(/<body[^>]*>[\s\S]*?<\/body>/i, () => `<body>${body}</body>`).replace('</head>', '<style>.export-document + .export-document{break-before:page}</style></head>')); printWindow.document.close(); printWindow.focus();
          const win = printWindow; window.setTimeout(() => { if (!win.closed) win.print(); }, 300);
        }
        if (count) downloadBlob(await zip.generateAsync({ type: 'blob' }), msg('ProjectExportDialog.m0729', { v0: sanitizeForFilename(project.data.title) }));
        setNotice(pdf.length ? msg('ProjectExportDialog.m0730', { v0: count ? msg('ProjectExportDialog.m0731') : '' }) : msg('ProjectExportDialog.m0732'));
      }
    } catch (e) { printWindow?.close(); if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : msg('ProjectExportDialog.m0733')); }
    finally { lock.current = false; setBusy(false); }
  };
  const toggleExpanded = (key: string) => setCollapsed(old => {
    const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next;
  });
  function disclosure(key: string, name: string) {
    return <button type="button" className="export-disclosure" aria-label={`${collapsed.has(key) ? msg('ProjectExportDialog.m0734') : msg('ProjectExportDialog.m0735')} ${name}`} aria-expanded={!collapsed.has(key)} onClick={() => toggleExpanded(key)}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={collapsed.has(key) ? 'm6 3 5 5-5 5' : 'm3 6 5 5 5-5'}/></svg>
    </button>;
  }
  function checkbox(rows: Entry[], name: string) {
    return <input className="ripple-checkbox" type="checkbox" aria-label={name} ref={node => { if (node) node.indeterminate = rows.some(e => selected.has(e.id)) && !rows.every(e => selected.has(e.id)); }} disabled={busy || !rows.length} checked={!!rows.length && rows.every(e => selected.has(e.id))} onChange={e => toggle(rows.map(r => r.id), e.target.checked)}/>;
  }
  function renderEntry(entry: Entry) {
    const name = paths.get(entry.id) ?? fileName(entry);
    const untimed = Boolean(entry.transcript && !canExportSubtitles(entry.transcript));
    return <li className="export-document-row" key={entry.document}>
      <div className="export-entry">
        <span className="export-disclosure-spacer"/>
        <label><input className="ripple-checkbox" type="checkbox" disabled={busy} checked={selected.has(entry.id)} onChange={event => toggle([entry.id], event.target.checked)}/><ProjectIcon kind="document"/><span className="export-entry-name">{name}</span></label>
        <div className="export-entry-options">
          <select aria-label={msg('ProjectExportDialog.m0736', { v0: entry.name })} title={untimed ? msg('ProjectExportDialog.m0737') : msg('ProjectExportDialog.m0738')} value={entryFormat(entry)} disabled={busy} onChange={e => setFormats(old => ({ ...old, [entry.id]: e.target.value as ExportFormat }))}>
            {exportFormats().map(([label, value]) => <option key={value} value={value} disabled={untimed && (value === 'srt' || value === 'vtt')}>{label}</option>)}
          </select>
        </div>
      </div>
    </li>;
  }
  return <dialog ref={dialog} className="material-preview-dialog project-export-dialog" aria-labelledby="project-export-heading" onKeyDown={trapDialogFocus} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-header"><h2 id="project-export-heading">{msg('ProjectExportDialog.m0739')}</h2><button className="icon-button" aria-label={msg('ProjectExportDialog.m0740')} disabled={busy} onClick={onClose}>×</button></div>
    <div className="project-export-scroll">
    {mode === 'choice' ? <div className="export-choice">
      <p>{msg('ProjectExportDialog.m0741')}</p>
      <button className="export-choice-option" disabled={busy} onClick={() => setMode('project')}><ProjectIcon kind="project"/><span><strong>{msg('ProjectExportDialog.m0742')}</strong><small>{msg('ProjectExportDialog.m0743')}</small></span></button>
      <button className="export-choice-option" disabled={busy} onClick={() => void exportFiles('materials')}><ProjectIcon kind="document"/><span><strong>{msg('ProjectExportDialog.m0744')}</strong><small>{msg('ProjectExportDialog.m0745')}</small></span></button>
    </div> : mode === 'project' ? <><p className="settings-hint">{msg('ProjectExportDialog.m0746')}</p><label className="field"><span>{msg('ProjectExportDialog.m0747')}</span><input value={title} disabled={busy} onChange={e => setTitle(e.target.value)}/></label><p className="settings-hint">{msg('ProjectExportDialog.m0748')}</p></> : <>
      <p className="settings-hint">{msg('ProjectExportDialog.m0749')}</p>
      {entries.some(e=>e.reference)&&<p className="settings-hint">{msg('ProjectExportDialog.m0750')}</p>}
      {hasPdf && <p className="settings-hint">{msg('ProjectExportDialog.m0751')}</p>}
      <div className="export-selection-tools"><span className="settings-hint">{msg('review.selectedMaterials', { count: chosen.length })}</span><button type="button" className="cred-btn" disabled={busy || loading || loadFailed} onClick={() => setSelected(new Set(visibleEntries.map(e => e.id)))}>{msg('ProjectExportDialog.m0754')}</button><button type="button" className="cred-btn" disabled={busy || loading || loadFailed} onClick={() => setSelected(new Set())}>{msg('ProjectExportDialog.m0755')}</button></div>
      {!loading && !loadFailed && !chosen.length && <p className="settings-hint" role="status">{visibleEntries.length ? msg('ProjectExportDialog.m0756') : msg('ProjectExportDialog.m0757')}</p>}
      {loading ? <p role="status">{msg('ProjectExportDialog.m0758')}</p> : loadFailed ? <button type="button" className="cred-btn" onClick={() => { setLoading(true); setLoadFailed(false); setError(''); setLoadAttempt(n => n + 1); }}>{msg('ProjectExportDialog.m0759')}</button> : project.data.interviews.map(session => {
        const rows = visibleEntries.filter(e => e.session === session.id);
        const key = `session/${session.id}`;
        return <section className="export-session" key={session.id}>
          <div className="export-tree-heading">{disclosure(key, session.title)}<label>{checkbox(rows, session.title)}<ProjectIcon kind="mic"/><span>{session.title}</span></label></div>
          {!collapsed.has(key) && <ul className="export-tree-children">
            {session.recordings.map(recording => {
              const files = rows.filter(e => e.recording === recording.id);
              const audio = files.find(e => e.audio);
              const documents = files.filter(e => e.transcript);
              if (!audio) return documents.map(renderEntry);
              const key = `audio/${session.id}/${recording.id}`;
              return <li key={recording.id}>
                <div className="export-entry export-audio-row">
                  {documents.length ? disclosure(key, audio.name) : <span className="export-disclosure-spacer"/>}
                  <label>{checkbox([audio], audio.name)}<ProjectIcon kind="audio"/><span className="export-entry-name">{paths.get(audio.id) ?? audio.name}</span></label>
                </div>
                {!collapsed.has(key) && documents.length > 0 && <ul className="export-tree-children">{documents.map(renderEntry)}</ul>}
              </li>;
            })}
          </ul>}
        </section>;
      })}

    </>}
    {error && <p role="alert" className="form-error">{uiMessage(error)}</p>}{notice && <p role="status" className="settings-hint">{uiMessage(notice)}</p>}
    </div><div className="project-actions audio-project-footer"><button className="button button--secondary" disabled={busy} onClick={() => mode === 'materials' ? onClose() : setMode('materials')}>{mode === 'materials' ? msg('ProjectExportDialog.m0760') : msg('ProjectExportDialog.m0761')}</button>{mode !== 'choice' && <button className="button button--primary" disabled={busy || (mode === 'project' ? !title.trim() : loading || loadFailed || (!chosen.length && !!visibleEntries.length) || invalidSubtitle)} onClick={() => { if (mode === 'materials' && !visibleEntries.length) setMode('project'); else if (mode === 'materials' && allSelected) setMode('choice'); else void exportFiles(); }}>{busy ? msg('ProjectExportDialog.m0762') : mode === 'project' ? msg('ProjectExportDialog.m0763') : !loading && !loadFailed && !visibleEntries.length ? msg('ProjectExportDialog.m0764') : msg('ProjectExportDialog.m0765')}</button>}</div>
  </dialog>;
}
