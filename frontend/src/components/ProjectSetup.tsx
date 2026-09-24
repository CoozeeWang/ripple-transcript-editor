import { IS_MAC } from '../lib/format';
import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { chooseDirectory, pickerLocation } from '../lib/projectPreferences';
import { AudioStorageIcon } from './AudioStorageIcon';
import { useAudioStorageChoice } from './useAudioStorageChoice';
import { ProcessingNotice } from './ProcessingNotice';
import { ManuscriptImportHint } from './ManuscriptImportHint';
import { manuscriptImportNotice } from '../lib/materialImport';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { AUDIO_EXT, defaultMetadata } from '../localStore';
import { prepareMaterials, type ImportMaterial } from '../lib/materialImport';
import { createProject, permit, importProjectMaterials, type OpenProject, type ProjectInterview, resolveMedia } from '../lib/projectStore';
import { droppedFiles, reorder, type DroppedFile } from '../lib/projectSetup';
import { PeopleInput } from './PeopleInput';
import { DateTimeInput } from './DateTimeInput';
import { validDateTime } from '../lib/dateTime';
import { InlineEdit } from './InlineEdit';
import { AudioPreview, PreviewDialog } from './MaterialImport';
import { ProjectIcon } from './ProjectIcon';
import './projectSetup.css';

type Material = ImportMaterial & { referenceable: boolean };
interface Props { project?: OpenProject; interviewId?: string; onDone: (project: OpenProject) => void; onCancel: () => void; onBusyChange?: (busy: boolean) => void }
const SORT = 'application/x-ripple-order';
export function ProjectSetup({ project, interviewId, onDone, onCancel, onBusyChange }: Props) {
  useInterfaceLanguage();
  const initial = project?.data.interviews.find(i => i.id === interviewId);
  const [title, setTitle] = useState(project?.data.title ?? '');
  const [sessions, setSessions] = useState<ProjectInterview[]>(initial ? [initial] : []);
  const [selected, setSelected] = useState(initial?.id ?? '');
  const [items, setItems] = useState<Material[]>(() => initial ? initial.recordings.filter(r=>r.storage!=='none').map(r=>({id:r.id,existingRecordingId:r.id,storage:r.storage==='reference'?'reference':'copy',name:r.name,group:initial.id,kind:'audio',audioId:'',referenceable:true,handle:{kind:'file',name:r.name,getFile:async()=>await(await resolveMedia(project!,initial.id,r)).getFile()} as FileSystemFileHandle})) : []);
  const [adding, setAdding] = useState(!initial);
  const [draft, setDraft] = useState({ title: '', date: '', location: '', people: [] as string[], notes: '' });
  const [dateError, setDateError] = useState(false);
  const locationInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'organize' | 'save'>('organize');
  const audioStorage = useAudioStorageChoice();
  const [parent, setParent] = useState<FileSystemDirectoryHandle | null>(null);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [partial, setPartial] = useState<OpenProject | null>(null);
  const [preview, setPreview] = useState<Material | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [undo, setUndo] = useState<Material[] | null>(null);
  const [dropMarker, setDropMarker] = useState<{ id: string; after: boolean } | null>(null);
  const dragging = useRef<{ id: string; group: string } | null>(null);
  const session = sessions.find(s => s.id === selected);
  const own = items.filter(i => i.group === selected);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (items.length || sessions.length || title) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [items.length, sessions.length, title]);
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try { await work(); } catch (e) { if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : msg('ProjectSetup.m0782')); }
    finally { inFlight.current = false; setBusy(false); onBusyChange?.(false); }
  };
  function drop(event: DragEvent, kind: 'audio' | 'manuscript', audioId = '') {
    event.preventDefault(); event.stopPropagation();
    if (busy || inFlight.current || !session || event.dataTransfer.types.includes(SORT)) return;
    const pending = droppedFiles(event.dataTransfer);
    void run(async () => addFiles(await pending, kind, audioId));
  }
  async function addFiles(files: DroppedFile[], kind: 'audio' | 'manuscript', audioId: string) {
      if (!session || !files.length) return;
      const added = await prepareMaterials(files.map(f => ({ handle: f.handle, group: session.id })));
      if (added.some(i => i.kind !== kind)) throw new Error(kind === 'audio' ? msg('ProjectSetup.m0783') : msg('ProjectSetup.m0784'));
      const accepted: Material[] = [];
      for (let index = 0; index < added.length; index++) {
        const next = added[index];
        for (const old of [...items, ...accepted]) {
          if (old.group === session.id && (old.handle === next.handle || (next.handle.isSameEntry && await next.handle.isSameEntry(old.handle)))) throw new Error(msg('ProjectSetup.m0785', { v0: next.name }));
        }
        accepted.push({ ...next, group: session.id, audioId, referenceable: files[index].referenceable });
      }
      if (kind === 'audio') { const storage = await audioStorage.choose(accepted.map(i=>i.name), accepted.every(i=>i.referenceable)); if (!storage) return; accepted.forEach(i=>{ i.storage=storage; }); }
      setItems(previous => [...previous, ...accepted]);setUndo(null);

  }
  function chooseFiles(kind: 'audio' | 'manuscript', audioId: string) {
    if (busy || !session) return;
    void run(async () => {
      const picker = window as unknown as { showOpenFilePicker: (options: { multiple: boolean; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]> };
      const accept: Record<string, string[]> = kind === 'audio'
        ? { 'audio/*': AUDIO_EXT.map(ext => `.${ext}`) }
        : { 'text/plain': ['.txt', '.srt', '.vtt'], 'application/json': ['.json'], 'application/msword': ['.doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] };
      const handles = await picker.showOpenFilePicker({ ...await pickerLocation(kind === 'audio' ? 'open-audio' : 'open-manuscript', 'read'), multiple: true, types: [{ description: kind === 'audio' ? msg('ProjectSetup.m0786') : msg('ProjectSetup.m0787'), accept }] });
      await addFiles(handles.map(handle => ({ handle, referenceable: true })), kind, audioId);
    });
  }
  const newSession = () => { setAdding(true);setDateError(false);setDraft({title:'',date:'',location:'',people:[],notes:''}); };
  const patchSession = (id: string, changes: Partial<ProjectInterview>) => setSessions(previous => previous.map(s => s.id === id ? { ...s, ...changes } : s));
  const patchMetadata = (changes: Partial<NonNullable<ProjectInterview['metadata']>>) => {
    if (session) patchSession(session.id, { metadata: { ...(session.metadata ?? defaultMetadata(session.title)), ...changes } });
  };
  const rename = (id: string, name: string) => { if (name.trim()) setItems(previous => previous.map(i => i.id === id ? { ...i, name: name.trim() } : i)); };
  const ignore = (item: Material) => { setUndo(items);setItems(previous => previous.filter(i => i.id !== item.id).map(i => i.audioId === item.id ? { ...i, audioId: '' } : i)); if (playing === item.id) setPlaying(null); };
  function sort(source: string, target: string, after: boolean, group: string) {
    if (group === 'sessions') setSessions(previous => reorder(previous, source, target, after));
    else setItems(previous => reorder(previous, source, target, after));
    setUndo(null);setDropMarker(null);
  }
  function sortZone(id: string, group: string) {
    return {
      'data-sort-edge': dropMarker?.id === id ? (dropMarker.after ? 'after' : 'before') : undefined,
      onDragOver: (e: DragEvent<HTMLElement>) => { if (!busy && !dragging.current && group.startsWith('audio:') && e.dataTransfer.types.includes('Files')) {e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';return;}if (busy || dragging.current?.group !== group || dragging.current.id === id) return;e.preventDefault();e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();setDropMarker({ id, after: e.clientY > r.top+r.height/2 }); },
      onDrop: (e: DragEvent<HTMLElement>) => { if (!dragging.current && group.startsWith('audio:')) {drop(e,'manuscript',id);return;}if (busy || !dragging.current || dragging.current.group !== group) return;e.preventDefault();e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();sort(dragging.current.id,id,e.clientY>r.top+r.height/2,group);dragging.current=null; },
    };
  }
  function handle(id: string, group: string, label: string, peers: { id: string }[]) {
    return <button type="button" className="setup-grip" aria-label={msg('ProjectSetup.m0788', { v0: label })} data-tip={msg('extra.reorder', { key: IS_MAC ? '⌥↑ / ⌥↓' : 'Alt+↑ / Alt+↓' })} data-tip-pos="top" disabled={busy} draggable={!busy}
      onDragStart={e => { e.stopPropagation();dragging.current={id,group};e.dataTransfer.setData(SORT,id);e.dataTransfer.effectAllowed='move'; }}
      onDragEnd={() => { dragging.current=null;setDropMarker(null); }}
      onKeyDown={e => { if (!e.altKey || !['ArrowUp','ArrowDown'].includes(e.key)) return;e.preventDefault();const n=peers.findIndex(i=>i.id===id)+(e.key==='ArrowUp'?-1:1);if(peers[n])sort(id,peers[n].id,e.key==='ArrowDown',group); }}><ProjectIcon kind="grip" /></button>;
  }
  function zone(kind: 'audio' | 'manuscript', label: string, audioId = '') {
    return <><button type="button" className="setup-drop setup-file-picker" disabled={busy} aria-label={label} title={msg('ProjectSetup.m0790')} onClick={()=>chooseFiles(kind,audioId)} onDragOver={e => { if(!busy && !e.dataTransfer.types.includes(SORT)){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';} }} onDrop={e => drop(e,kind,audioId)}><ProjectIcon kind={kind==='audio'?'audio':'document'} /><span>{label}</span></button>{kind==='manuscript'&&<ManuscriptImportHint/>}</>;
  }
  function document(item: Material, peers: Material[]) {
    return <div className="setup-document" key={item.id} {...sortZone(item.id,`docs:${selected}:${item.audioId}`)}>
      <ProjectIcon kind="document" /><span className="setup-document-name"><InlineEdit doubleClick disabled={busy} value={item.name} ariaLabel={msg('ProjectSetup.m0791')} onCommit={name=>rename(item.id,name)} />
      {item.isOriginal && <span className="manuscript-original-badge" title={msg('ProjectSetup.m0792')}>{msg('ProjectSetup.m0793')}</span>}
      {manuscriptImportNotice(item)&&<small className="manuscript-import-notice">{manuscriptImportNotice(item)}</small>}</span>
      <span className="setup-row-actions"><button type="button" className="material-remove" disabled={busy} aria-label={`${item.isOriginal?msg('ProjectSetup.m0794'):msg('ProjectSetup.m0795')} ${item.name}`} data-tip={item.isOriginal?msg('ProjectSetup.m0796'):msg('ProjectSetup.m0797')} data-tip-pos="top" aria-pressed={!!item.isOriginal} onClick={()=>{if(!item.isOriginal&&!window.confirm(msg('ProjectSetup.m0798')))return;setItems(previous=>previous.map(m=>m.id===item.id?{...m,isOriginal:!m.isOriginal}:m));}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 3h14v18l-7-4-7 4V3Z"/></svg></button>
      <button className="material-remove" type="button" disabled={busy} aria-label={msg('ProjectSetup.m0799', { v0: item.name })} data-tip={msg('ProjectSetup.m0800')} data-tip-pos="top" onClick={()=>setPreview(item)}><ProjectIcon kind="preview" /></button>
      {item.audioId && <button className="material-remove" type="button" disabled={busy} aria-label={msg('ProjectSetup.m0801', { v0: item.name })} data-tip={msg('ProjectSetup.m0802')} data-tip-pos="top" onClick={()=>setItems(previous=>previous.map(i=>i.id===item.id?{...i,audioId:''}:i))}><ProjectIcon kind="unlink" /></button>}
      <button className="material-remove" type="button" disabled={busy} aria-label={msg('ProjectSetup.m0803', { v0: item.name })} data-tip={msg('ProjectSetup.m0804')} data-tip-pos="top" onClick={()=>ignore(item)}><ProjectIcon kind="ignore" /></button>
      {handle(item.id,`docs:${selected}:${item.audioId}`,item.name,peers)}</span>
    </div>;
  }
  const save = () => run(async () => {
    if (!title.trim() || (!project && !parent)) throw new Error(msg('ProjectSetup.m0805'));
    if (items.some(i=>i.storage==='reference'&&!i.referenceable)) throw new Error(msg('ProjectSetup.m0806'));
    if (!project && !partial) await permit(parent!, 'readwrite');
    const target = project ?? partial ?? await createProject(parent!,title);
    setPartial(target);
    const ordered = sessions.flatMap(s=>items.filter(i=>i.group===s.id));
    const result = await importProjectMaterials(target,ordered,'copy',undefined,sessions);
    setPartial(null);onDone(result);
  });
  const edit = (value: string, label: string, commit: (value: string)=>void, placeholder: string, inputType='text'): ReactNode => <InlineEdit doubleClick={Boolean(value)} disabled={busy} value={value} ariaLabel={label} onCommit={commit} placeholder={placeholder} inputType={inputType} />;
  const nextStepHint = step === 'save'
    ? (!project && !parent ? msg('ProjectSetup.m0807') : '')
    : !title.trim() ? msg('ProjectSetup.m0808')
    : adding ? (!draft.title.trim() ? msg('ProjectSetup.m0809') : msg('ProjectSetup.m0810'))
    : !sessions.length ? msg('ProjectSetup.m0811') : '';
  return <section className="project-setup" aria-label={msg('ProjectSetup.m0812')} aria-busy={busy} onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files'))setError(msg('ProjectSetup.m0813'));}}>
    <div className="setup-title"><ProjectIcon kind="project" /><h1>{edit(title,msg('ProjectSetup.m0814'),v=>{if(!project&&!partial)setTitle(v);},msg('ProjectSetup.m0815'))}</h1>{project && <span>{msg('ProjectSetup.m0816')}</span>}</div>
    {error && <p className="form-error setup-message" role="alert">{uiMessage(error)}</p>}
    {busy && <ProcessingNotice>{msg('ProjectSetup.m0817')}</ProcessingNotice>}
    {step==='organize' ? <div className="setup-body"><aside className="setup-sidebar" aria-label={msg('ProjectSetup.m0818')}><p className="section-label">{msg('ProjectSetup.m0819')}</p>
      {sessions.map(s=><div className={`setup-session${!adding&&s.id===selected?' is-selected':''}`} key={s.id} {...sortZone(s.id,'sessions')}><div role="button" tabIndex={0} className="setup-session-select" aria-disabled={busy} aria-pressed={!adding&&s.id===selected} onKeyDown={e=>{if(e.target===e.currentTarget && (e.key==='Enter'||e.key===' ')&&!busy){e.preventDefault();setSelected(s.id);setAdding(false);}}} onClick={()=>{if(!busy){setSelected(s.id);setAdding(false);setPlaying(null);}}}><ProjectIcon kind="mic" /><span><InlineEdit doubleClick disabled={busy} value={s.title} ariaLabel={msg('ProjectSetup.m0820', { v0: s.title })} onCommit={title=>{if(title.trim())patchSession(s.id,{title:title.trim()});}}/><small>{s.metadata?.recorded_at?.slice(0,10) || msg('ProjectSetup.m0821')}</small></span></div>{handle(s.id,'sessions',s.title,sessions)}</div>)}
      {!initial && <button type="button" className="setup-drop setup-new" disabled={busy||adding} onClick={newSession}><ProjectIcon kind="plus" />{msg('ProjectSetup.m0822')}</button>}
    </aside><div className="setup-canvas">
      {adding ? <form className="setup-session-form" onSubmit={e=>{e.preventDefault();if(!draft.title.trim())return;if(!validDateTime(draft.date)){setDateError(true);return;}const id=crypto.randomUUID();const s: ProjectInterview={id,title:draft.title.trim(),metadata:{...defaultMetadata(draft.title.trim()),id,recorded_at:draft.date||null,location:draft.location,notes:draft.notes,participants:draft.people.map(name=>({name,role:''}))},recordings:[]};setSessions(old=>[...old,s]);setSelected(id);setAdding(false);}}>
        <h2>{edit(draft.title,msg('ProjectSetup.m0823'),title=>setDraft(old=>({...old,title:title.trim()})),msg('ProjectSetup.m0824'))}</h2>
        <div className="setup-fields"><div className={`field setup-date-row${dateError ? ' has-error' : ''}`} title={dateError ? msg('ProjectSetup.m0825') : undefined}><span>{msg('ProjectSetup.m0826')}</span><DateTimeInput label={msg('ProjectSetup.m0827')} includeTime={false} autoFocus={false} value={draft.date} onChange={date=>{setDraft({...draft,date});setDateError(false);}} onCommit={()=>{setDateError(!validDateTime(draft.date));}} onCancel={()=>{setDraft({...draft,date:''});setDateError(false);locationInput.current?.focus();}}/>{dateError&&<span role="alert" className="inline-date-error">{msg('ProjectSetup.m0828')}</span>}</div><label className="field"><span>{msg('ProjectSetup.m0829')}</span><input ref={locationInput} value={draft.location} onChange={e=>setDraft({...draft,location:e.target.value})} /></label><div className="field"><span>{msg('ProjectSetup.m0830')}</span><PeopleInput names={draft.people} disabled={busy} onChange={people=>setDraft(old=>({...old,people}))} /></div><label className="field"><span>{msg('ProjectSetup.m0831')}</span><input value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})} /></label></div>
        <div className="project-actions setup-confirm-actions">{sessions.length>0 && <button type="button" className="cred-btn" onClick={()=>setAdding(false)}>{msg('ProjectSetup.m0832')}</button>}<button className="cred-btn" disabled={busy||!draft.title.trim()}>{msg('ProjectSetup.m0833')}</button></div>
      </form> : session ? <><h2>{edit(session.title,msg('ProjectSetup.m0834'),v=>{if(v.trim())patchSession(session.id,{title:v.trim()});},msg('ProjectSetup.m0835'))}</h2>
        <div className="setup-metadata"><span><ProjectIcon kind="calendar" />{edit(session.metadata?.recorded_at?.slice(0,10)||'',msg('ProjectSetup.m0836'),v=>patchMetadata({recorded_at:v||null}),msg('ProjectSetup.m0837'),'date')}</span><span><ProjectIcon kind="location" />{edit(session.metadata?.location||'',msg('ProjectSetup.m0838'),v=>patchMetadata({location:v}),msg('ProjectSetup.m0839'))}</span><span><ProjectIcon kind="people" /><PeopleInput key={session.id} disabled={busy} names={session.metadata?.participants.map(p=>p.name)||[]} onChange={names=>patchMetadata({participants:names.map(name=>session.metadata?.participants.find(p=>p.name===name)||{name,role:''})})}/></span></div>
        <p className="setup-notes">{edit(session.metadata?.notes||'',msg('ProjectSetup.m0840'),v=>patchMetadata({notes:v}),msg('ProjectSetup.m0841'))}</p>
        {own.filter(i=>i.kind==='audio').map(item=>{const linked=own.filter(i=>i.audioId===item.id);return <article className="setup-audio" key={item.id} {...sortZone(item.id,`audio:${selected}`)}><div className="setup-audio-heading"><AudioStorageIcon storage={item.storage??'copy'} pending={!item.existingRecordingId}/><div className="setup-audio-name"><strong>{edit(item.name,msg('ProjectSetup.m0842'),name=>rename(item.id,name),item.name)}</strong>{durations[item.id]?<small>{Math.floor(durations[item.id]/60)}:{String(Math.floor(durations[item.id]%60)).padStart(2,'0')}</small>:null}</div><span className="setup-row-actions"><button type="button" className="material-remove" disabled={busy} aria-label={msg('ProjectSetup.m0843', { v0: item.name })} data-tip={msg('ProjectSetup.m0844')} data-tip-pos="top" aria-expanded={playing===item.id} onClick={()=>setPlaying(playing===item.id?null:item.id)}><ProjectIcon kind="play" /></button><button type="button" className="material-remove" disabled={busy} aria-label={msg('ProjectSetup.m0845', { v0: item.name })} data-tip={msg('ProjectSetup.m0846')} data-tip-pos="top" onClick={()=>ignore(item)}><ProjectIcon kind="ignore" /></button>{handle(item.id,`audio:${selected}`,item.name,own.filter(i=>i.kind==='audio'))}</span></div>
          {playing===item.id && <div className="setup-audition"><AudioPreview item={item} onDuration={duration=>setDurations(old=>old[item.id]===duration?old:{...old,[item.id]:duration})} /></div>}
          {linked.length>0 && <div className="setup-linked"><p>{msg('ProjectSetup.m0847')}</p>{linked.map(doc=>document(doc,linked))}{linked.some(d=>d.transcript?.timeAligned!==false && d.transcript?.segments.some(s=>s.end>durations[item.id]+2)) && <p role="status" className="form-error">{msg('ProjectSetup.m0848')}</p>}</div>}
          {zone('manuscript',msg('ProjectSetup.m0849'),item.id)}</article>;})}
        {zone('audio',msg('ProjectSetup.m0850'))}
        <section className="setup-independent" onDragOver={e=>{if(!busy&&!e.dataTransfer.types.includes(SORT)){e.preventDefault();e.stopPropagation();}}} onDrop={e=>drop(e,'manuscript')}><h3>{msg('ProjectSetup.m0851')}</h3>{own.filter(i=>i.kind==='manuscript'&&!i.audioId).map(item=>document(item,own.filter(i=>i.kind==='manuscript'&&!i.audioId)))}{zone('manuscript',msg('ProjectSetup.m0852'))}</section>
      </> : <p className="settings-hint">{msg('ProjectSetup.m0853')}</p>}
    </div></div> : <div className="setup-save"><h2>{project?msg('ProjectSetup.m0854'):msg('ProjectSetup.m0855')}</h2>
      {!project && <div className="project-section"><h3>{msg('ProjectSetup.m0856')}</h3><p className="settings-hint">{msg('review.projectFolder', { projectName: title.trim() })}</p><div className="project-actions"><span>{parent?.name||msg('ProjectSetup.m0859')}</span><button type="button" className="button button--secondary" disabled={busy||!!partial} onClick={()=>void run(async()=>setParent(await chooseDirectory('save-project')))}>{msg('ProjectSetup.m0860')}</button></div></div>}
      <p className="settings-hint">{msg('ProjectSetup.m0861')}</p>
    </div>}
    {audioStorage.dialog}<footer className="setup-footer"><div className="setup-footer-status" role="status">{undo ? <><span>{msg('ProjectSetup.m0862')}</span><button type="button" className="setup-undo" disabled={busy} onClick={()=>{setItems(undo);setUndo(null);}}>{msg('ProjectSetup.m0863')}</button></> : <span>{step==='organize'?msg('ProjectSetup.m0864', { v0: sessions.length }):msg('ProjectSetup.m0865')}{nextStepHint && <small className="setup-next-hint">{nextStepHint}</small>}</span>}</div><div className="project-actions"><button type="button" className="button button--secondary" disabled={busy} onClick={()=>{if(step==='save')setStep('organize');else if((!items.length&&!sessions.length)||window.confirm(msg('ProjectSetup.m0866')))onCancel();}}>{step==='save'?msg('ProjectSetup.m0867'):msg('ProjectSetup.m0868')}</button>{step==='organize'?<>{!initial && <button type="button" className="button button--secondary" disabled={busy||adding} onClick={newSession}><ProjectIcon kind="plus" />{msg('ProjectSetup.m0869')}</button>}<button type="button" className="button button--primary" disabled={busy||!title.trim()||!sessions.length||adding} onClick={()=>{setError('');setStep('save');}}>{msg('ProjectSetup.m0870')}</button></>:<button type="button" className="button button--primary" disabled={busy||(!project&&!parent)} onClick={()=>void save()}>{project?msg('ProjectSetup.m0871'):msg('ProjectSetup.m0872')}</button>}</div></footer>
    {preview && <PreviewDialog item={preview} onClose={()=>setPreview(null)} />}
  </section>;
}
