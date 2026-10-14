import type { ContinuationReceipt, Segment } from '../types';
import type { ConnectorDocument, ConnectorHost, ConnectorSaveMode, ConnectorVersion } from './aiConnector';
import { applyAISuggestions, nextAIEditName } from './aiVersionEdits';
import { checkContinuationGuard, type ContinuationGuard } from './continuationBatch';

type Action = 'edit' | 'delete' | 'merge_previous';
interface Change { segment_id: string; before: string; after: string; action: Action }
interface Batch {
  id: string; segments: Segment[]; guard: ContinuationGuard;
  changes: Change[]; checked: string[];
}
export interface ContinuationTask {
  schema: 1; id: string; source: ConnectorVersion; target: ConnectorVersion;
  saveMode: ConnectorSaveMode; name: string; rules: string[]; actions: Action[];
  ids: string[]; done: string[]; summary: string;
  state: 'draft' | 'paused' | 'completed' | 'cancelled'; reason?: string;
  batch?: Batch; held: Batch[]; pending?: ContinuationReceipt;
  lastReceipt?: ContinuationReceipt; updated: string;
  receipts?: ContinuationReceipt[];
}
export interface ContinuationStore {
  /** Session-local identity; no path is returned to clients. */
  scope: string;
  read: () => Promise<ContinuationTask[]>;
  write: (task: ContinuationTask) => Promise<void>;
}
export interface ContinuationProgress {
  task_id: string; state: ContinuationTask['state']; reason?: string;
  version: string; version_id: string; saved_segments: number; total_segments: number; staged: number;
  held_batches: number; is_current: boolean;
  saved_batches?: number; batch_number?: number; updated?: string;
}
const progress = (task: ContinuationTask, doc: ConnectorDocument): ContinuationProgress => {
  const history = [...(task.receipts ?? []), ...(task.lastReceipt ? [task.lastReceipt] : [])];
  const receipts = new Set(history.map(receipt => receipt.batch_id));
  const covered = new Set(history.flatMap(receipt => receipt.processed_ids));
  // Older journals may know the saved segments without a complete batch history.
  const savedBatches = task.done.length === 0 ? 0 : task.done.every(id => covered.has(id)) ? receipts.size : undefined;
  return {
  task_id: task.id, state: task.state, reason: task.reason, version: task.target.id===doc.version.id?doc.version.name:task.target.name,
  version_id: task.target.id, saved_segments: task.done.length, total_segments: task.ids.length,
  staged: task.batch?.checked.length ?? 0, held_batches: task.held.length,
  is_current: task.target.id === doc.version.id,
  saved_batches: savedBatches,
  batch_number: savedBatches === undefined ? undefined : savedBatches + (task.state === 'draft' || task.state === 'paused' ? 1 : 0),
  updated: task.updated,
  };
};
function fail(code: string): never { throw Error(code); }
const readableSegment=(s:Segment)=>({id:s.id,speaker_id:s.speaker_id,start:s.start,end:s.end,text:s.text});

/** Small durable batches. Old atomic continuation tasks remain independently supported. */
export class IncrementalContinuation {
  private tasks = new Map<string, ContinuationTask>();
  private scope = '';
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private host: ConnectorHost) {}
  private async load(doc: ConnectorDocument) {
    if (!doc.continuations) fail('durable_tasks_unavailable');
    if (this.scope !== doc.continuations.scope) {
      this.tasks = new Map((await doc.continuations.read()).map(task => [task.id, task]));
      this.scope = doc.continuations.scope;
    }
    // A manuscript receipt and pending journal resolve a crash after file save but before progress save.
    for (const task of this.tasks.values()) {
      let receipt = doc.transcript.aiContinuationReceipts?.[task.id], version = doc.version;
      if (task.pending && receipt?.batch_id !== task.pending.batch_id && task.saveMode === 'new_version') {
        // After an uncertain first save, locate only this named work version within this interview.
        const candidates=(await doc.references()).filter(r=>r.version.kind==='edit').sort((a,b)=>Number(b.version.name===task.name)-Number(a.version.name===task.name));
        for(const candidate of candidates) {
          const saved=await candidate.load();const found=saved?.aiContinuationReceipts?.[task.id];
          if(found?.task_id===task.id&&found.source_version_id===task.source.id&&found.batch_id===task.pending.batch_id&&found.version_id===candidate.version.id){receipt=found;version=candidate.version;break;}
        }
      }
      if (task.pending && receipt?.batch_id === task.pending.batch_id && receipt.version_id === version.id) {
        const recovered=structuredClone(task);
        this.finish(recovered, receipt, version);
        await this.save(recovered, doc);
      }
    }
    this.notify(doc);
  }
  private notify(doc: ConnectorDocument) { this.host.continuationProgress?.([...this.tasks.values()].map(task => progress(task, doc))); }
  private async save(task: ContinuationTask, doc: ConnectorDocument) {
    task.updated = new Date().toISOString();
    if (!doc.continuations) fail('durable_tasks_unavailable');
    await doc.continuations.write(structuredClone(task));
    this.tasks.set(task.id, task); this.notify(doc);
  }
  private finish(task: ContinuationTask, receipt: ContinuationReceipt, version: ConnectorVersion) {
    task.target = version; task.name = version.name;
    task.done = [...new Set([...task.done, ...receipt.processed_ids])];
    task.lastReceipt = receipt; task.pending = undefined; task.batch = undefined; task.reason = undefined;
    task.receipts=[...(task.receipts??[]).filter(r=>r.batch_id!==receipt.batch_id),receipt];
    task.state = task.done.length === task.ids.length ? 'completed' : 'draft';
  }
  private requireTarget(task: ContinuationTask, doc: ConnectorDocument) {
    if (doc.version.id !== task.target.id) fail('open_task_target_version_first');
  }
  private result(task: ContinuationTask, doc: ConnectorDocument) {
    return { ...progress(task, doc), result_version: task.target.id===doc.version.id?doc.version:task.target, save_mode: task.saveMode,
      batch_id: task.lastReceipt?.batch_id ?? null, changed_segments: task.lastReceipt?.changed_segments ?? 0,
      deleted_segments: task.lastReceipt?.deleted_segments ?? 0, merged_segments: task.lastReceipt?.merged_segments ?? 0,
      complete: task.state === 'completed', summary: task.summary };
  }
  prepare(doc: ConnectorDocument, a: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      await this.load(doc);
      if (typeof a.start_id !== 'string') return { needs_clarification: ['continuation_start'], writable: false };
      if (a.save_mode === undefined) return { needs_clarification: ['save_mode'], writable: false,
        save_options: doc.editable === false || doc.version.kind === 'original' ? ['new_version'] : ['new_version','current_version'] };
      if (!['new_version','current_version'].includes(String(a.save_mode))) fail('invalid_save_mode');
      if (a.save_mode === 'current_version' && (doc.editable === false || doc.version.kind === 'original')) fail('current_version_read_only_create_new_version');
      if (!Array.isArray(a.rules) || !a.rules.length || a.rules.length > 30 || a.rules.some(rule => typeof rule !== 'string' || !rule.trim() || rule.length > 2000)) fail('key_style_rules_required');
      const actions = a.allowed_actions ?? ['edit'];
      if (!Array.isArray(actions) || !actions.length || actions.length > 3 || new Set(actions).size !== actions.length || actions.some(action => !['edit','delete','merge_previous'].includes(action))) fail('invalid_allowed_actions');
      const segments = doc.transcript.segments;
      const first = segments.findIndex(s => s.id === a.start_id), last = a.end_id === undefined ? segments.length - 1 : segments.findIndex(s => s.id === a.end_id);
      if (first < 0 || last < first) fail('invalid_range');
      // Incremental structural batches operate on complete segments; old atomic mode handles partial offsets.
      if ((a.start_offset !== undefined && a.start_offset !== 0) || (a.end_offset !== undefined && a.end_offset !== segments[last].text.length)) fail('incremental_requires_full_segments');
      if ([...this.tasks.values()].some(t => t.target.id === doc.version.id && ['draft','paused'].includes(t.state))) fail('resume_or_cancel_existing_continuation');
      const ids = segments.slice(first,last+1).map(s => s.id);
      if (ids.length !== new Set(ids).size || segments.slice(first,last+1).some(s => s.text.length > 12000)) fail('segment_too_large_or_duplicate');
      const name = a.save_mode === 'new_version' ? nextAIEditName(doc.label,doc.names) : doc.label;
      const id = crypto.randomUUID();
      const summary = JSON.stringify({ source_version: doc.version, save_mode: a.save_mode, start_id: ids[0], end_id: ids.at(-1), rules: a.rules, allowed_actions: actions, delivery_mode: 'incremental', result_version_name: name });
      const task: ContinuationTask = { schema:1,id,source:doc.version,target:doc.version,saveMode:a.save_mode as ConnectorSaveMode,name,rules:a.rules as string[],actions:actions as Action[],ids,done:[],summary,state:'draft',held:[],updated:'' };
      await this.save(task,doc);
      return { task_id:id,summary,segment_count:ids.length,delivery_mode:'incremental',target_version:doc.version,
        instruction:'Confirm this scope and save choice once. Read a continuation batch, stage changed segments and unchanged_ids, then save_continuation_batch using its batch_id and the agreed summary. Each saved batch is visible in Ripple. Repeat until complete. Resume a paused batch only after the user asks; do not overwrite manual changes.' };
    });
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run); this.queue = next.catch(() => {}); return next;
  }
  handle(operation: string, a: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.serial(()=>this.execute(operation,a));
  }
  private async execute(operation:string,a:Record<string,unknown>):Promise<Record<string,unknown>> {
      const doc = await this.host.current(); await this.load(doc);
      if (operation === 'tasks') return { tasks:[...this.tasks.values()].map(t => progress(t,doc)),current_version:doc.version };
      const task = this.tasks.get(String(a.task_id)); if (!task) fail('task_not_found_in_current_interview');
      if(operation==='proposals') {
        const batch=task.batch?.changes.length?task.batch:task.held.at(-1);
        return {proposals:(batch?.changes??[]).filter(c=>c.action!=='edit'||c.before!==c.after).map(c=>({
          segment_id:c.segment_id,action:c.action,before:c.before,after:c.after,
          current_text:doc.transcript.segments.find(s=>s.id===c.segment_id)?.text??null,
          index:doc.transcript.segments.findIndex(s=>s.id===c.segment_id)+1,
        }))};
      }
      if (operation === 'status') return { ...this.result(task,doc), published:task.done.length > 0,
        remaining_ids:task.ids.filter(id => !task.done.includes(id)).slice(0,32),
        pending_batch_id:task.batch?.id ?? null, pending_changes:task.batch?.changes.length ?? 0 };
      this.requireTarget(task,doc);
      if (operation === 'cancel') {
        if (task.state === 'completed') fail('task_already_completed');
        task.state='cancelled';task.reason='user_cancelled';await this.save(task,doc);
        return { cancelled:true,saved_segments:task.done.length,already_saved_batches_retained:true };
      }
      if (operation === 'pause') {
        if (task.state !== 'draft') fail('task_not_editable');
        task.state='paused';task.reason='user_paused';await this.save(task,doc);return this.result(task,doc);
      }
      if (operation === 'resume') {
        if (task.state !== 'paused') fail('task_not_paused');
        if(task.reason==='planned_segment_changed')fail('scope_changed_end_task_and_prepare_new_range');
        if (task.batch && !checkContinuationGuard(doc.transcript,task.batch.guard)) { task.held.push({...task.batch,guard:{...task.batch.guard,segments:task.batch.guard.segments.map(readableSegment)}});task.batch=undefined;task.pending=undefined; }
        task.state='draft';task.reason=undefined;await this.save(task,doc);return this.result(task,doc);
      }
      const previousReceipt=task.receipts?.find(r=>r.batch_id===a.batch_id) ?? (task.lastReceipt?.batch_id===a.batch_id?task.lastReceipt:undefined);
      if (operation === 'checkpoint' && previousReceipt) {
        if(a.confirmed_summary!==task.summary)fail('confirmation_changed');
        return { ...this.result(task,doc),saved:true,repeated:true,batch_id:previousReceipt.batch_id,changed_segments:previousReceipt.changed_segments };
      }
      if(operation==='checkpoint'&&(a.changes!==undefined||a.unchanged_ids!==undefined)) {
        if(a.confirmed_summary!==task.summary)fail('confirmation_changed');
        const staged=await this.execute('stage',a);
        if(staged.conflict||staged.state==='paused')return staged;
        return this.execute('checkpoint',{...a,changes:undefined,unchanged_ids:undefined});
      }
      if(operation==='publish'&&task.state==='completed') {
        if(a.confirmed_summary!==task.summary)fail('confirmation_changed');
        return {...this.result(task,doc),saved:true};
      }
      if(operation==='publish')fail('incremental_use_save_continuation_batch');
      if (task.state !== 'draft') return { ...this.result(task,doc),needs_resume:task.state === 'paused',saved:false };
      if (operation === 'batch') {
        if (!task.batch) {
          const remaining = task.ids.filter(id => !task.done.includes(id));
          const byId = new Map(doc.transcript.segments.map((s,i) => [s.id,{s,i}]));
          const selected: Segment[]=[];let chars=0;
          for (const id of remaining.slice(0,24)) {
            const item=byId.get(id);if(!item) {task.state='paused';task.reason='planned_segment_changed';await this.save(task,doc);return this.result(task,doc);}
            if (item.s.text.length > 12000) fail('segment_too_large_split_in_ripple_first');
            if(selected.length && chars+item.s.text.length > 6000)break;
            selected.push(item.s);chars+=item.s.text.length;
          }
          if(!selected.length)fail('task_already_completed');
          const first=byId.get(selected[0].id)!.i,last=byId.get(selected.at(-1)!.id)!.i;
          const span=doc.transcript.segments.slice(first,last+1);
          if(span.length!==selected.length||span.some((s,i)=>s.id!==selected[i].id)) {
            task.state='paused';task.reason='planned_segment_changed';await this.save(task,doc);return this.result(task,doc);
          }
          const guards=doc.transcript.segments.slice(Math.max(0,first-1),last+2);
          const speakers=new Set(guards.map(s=>s.speaker_id));
          task.batch={id:crypto.randomUUID(),segments:structuredClone(selected.map(readableSegment)),guard:{segments:structuredClone(guards),speakers:structuredClone(doc.transcript.speakers.filter(s=>speakers.has(s.id)))},changes:[],checked:[]};
          await this.save(task,doc);
        }
        return { task_id:task.id,batch_id:task.batch.id,summary:task.summary,segments:task.batch.segments.map(readableSegment),
          speakers:task.batch.guard.speakers.map(s=>({id:s.id,name:s.name})),
          context:task.batch.guard.segments.filter(s=>!task.batch!.segments.some(b=>b.id===s.id)).map(s=>{
            const preceding=task.batch!.guard.segments[0].id===s.id;
            const characters=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(s.text)].map(g=>g.segment);
            const text=(preceding?characters.slice(-500):characters.slice(0,500)).join('');
            return {...readableSegment(s),text,context_excerpt:text!==s.text,text_offset:preceding?s.text.length-text.length:0};
          }),
          staged_changes:task.batch.changes,checked_ids:task.batch.checked,saved_segments:task.done.length,total_segments:task.ids.length };
      }
      const batch=task.batch;if(!batch)fail('read_continuation_batch_first');
      const conflict=!checkContinuationGuard(doc.transcript,batch.guard);
      if (operation !== 'stage' && conflict) {
        task.state='paused';task.reason='batch_conflict_manual_changes_preserved';await this.save(task,doc);
        return { ...this.result(task,doc),saved:false,conflict:true,proposals_retained:true };
      }
      if (operation === 'stage') {
        if(a.batch_id!==batch.id)fail('batch_id_mismatch');
        const raw=a.changes ?? [],unchanged=a.unchanged_ids ?? [];
        if(!Array.isArray(raw)||!Array.isArray(unchanged)||raw.length+unchanged.length>32||!raw.length&&!unchanged.length)fail('invalid_batch');
        const changes=new Map(batch.changes.map(c=>[c.segment_id,c])),checked=new Set(batch.checked),seen=new Set<string>();
        const source=new Map(batch.segments.map(s=>[s.id,s]));
        for (const item of raw) {
          if(!item || typeof item !== 'object')fail('invalid_change');
          const c=item as Change,action=c.action ?? 'edit',segment=source.get(c.segment_id);
          if(!segment||seen.has(c.segment_id)||typeof c.after!=='string'||c.before!==segment.text||c.after.length>16000||!task.actions.includes(action)||(action==='delete'?c.after!=='':!c.after.trim()))fail('invalid_change');
          seen.add(c.segment_id);checked.add(c.segment_id);changes.set(c.segment_id,{...c,action});
        }
        for (const id of unchanged) {
          if(typeof id!=='string'||!source.has(id)||seen.has(id))fail('invalid_unchanged_segment');
          seen.add(id);checked.add(id);changes.delete(id);
        }
        const allowed=new Set([...batch.segments.map(s=>s.id),...task.done]);
        for(const c of changes.values())if(c.action==='merge_previous') {
          let index=batch.guard.segments.findIndex(s=>s.id===c.segment_id)-1;
          while(index>=0&&changes.get(batch.guard.segments[index].id)?.action==='delete')index--;
          if(index<0||!allowed.has(batch.guard.segments[index].id))fail('merge_previous_outside_scope');
        }
        // Small local validation; no repeated whole-manuscript stringify or accumulated re-application.
        const small={audio:doc.transcript.audio,speakers:batch.guard.speakers,segments:batch.guard.segments};
        applyAISuggestions(small,small,[...changes.values()].map(c=>({id:c.segment_id,text:c.after,action:c.action,reason:''})));
        batch.changes=[...changes.values()];batch.checked=[...checked];await this.save(task,doc);
        if(conflict){task.state='paused';task.reason='batch_conflict_manual_changes_preserved';await this.save(task,doc);return {...this.result(task,doc),saved:false,conflict:true,proposals_retained:true};}
        return { staged:batch.checked.length,remaining:batch.segments.length-batch.checked.length,published:false,draft_saved:true };
      }
      if(operation==='checkpoint'||operation==='publish') {
        if(a.confirmed_summary!==task.summary)fail('confirmation_changed');
        if(operation==='checkpoint'&&a.batch_id!==batch.id)fail('batch_id_mismatch');
        if(batch.checked.length!==batch.segments.length)fail('incomplete_batch_continue_staging');
        const changes=batch.changes.filter(c=>c.action!=='edit'||c.before!==c.after);
        const receipt:ContinuationReceipt={task_id:task.id,batch_id:batch.id,source_version_id:task.source.id,version_id:'',processed_ids:batch.segments.map(s=>s.id),changed_segments:changes.length,deleted_segments:changes.filter(c=>c.action==='delete').length,merged_segments:changes.filter(c=>c.action==='merge_previous').length};
        task.pending=receipt;await this.save(task,doc);
        try {
          const result=await this.host.publish(doc.transcript,changes.map(c=>({id:c.segment_id,text:c.after,action:c.action,reason:task.rules.join('; ')})),task.name,
            {save_mode:task.saveMode==='new_version'&&task.target.id===task.source.id?'new_version':'current_version',source_version:doc.version,identity:doc.identity,task_id:task.id,checkpoint:{guard:batch.guard,receipt}});
          const version=result.result_version as ConnectorVersion|undefined;if(!version)fail('batch_save_result_unavailable');
          receipt.version_id=version.id;const committed=structuredClone(task);this.finish(committed,receipt,version);
          await this.save(committed,doc);
          let rulesSaved=true;try{await doc.remember?.(task.rules);}catch{rulesSaved=false;}
          let nextBatch:Record<string,unknown>|null=null,nextError:string|undefined;
          if(committed.state!=='completed')try{nextBatch=await this.execute('batch',{task_id:task.id});}catch(error){const message=error instanceof Error?error.message:'';nextError=/^[a-z_]+$/.test(message)?message:'next_batch_unavailable';}
          return {...this.result(committed,{...doc,version}),saved:true,rules_saved:rulesSaved,new_version_created:version.id!==doc.version.id,next_batch:nextBatch,next_batch_error:nextError};
        } catch(error) {
          const message=error instanceof Error?error.message:'';
          task.state='paused';task.reason=/^[a-z_]+$/.test(message)?message:'batch_save_failed';
          // A pending receipt is retained for recovery after uncertain writes; never blindly re-apply.
          await this.save(task,doc).catch(()=>{});throw error;
        }
      }
      fail('unsupported_operation');
  }
}
