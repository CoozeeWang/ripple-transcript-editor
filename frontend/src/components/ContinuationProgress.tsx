import {useState} from 'react';
import {msg,useInterfaceLanguage} from '../i18n';
import type {ContinuationProgress as Progress} from '../lib/incrementalContinuation';

/** Prefer recoverable work over completed history; never discard the stored tasks. */
function currentTask(tasks:Progress[]) {
  const visible=tasks.filter(task=>task.state!=='cancelled'&&(task.state!=='completed'||task.is_current));
  const rank=(task:Progress)=>(task.state!=='completed'?2:0)+(task.is_current?1:0);
  return visible.reduce<Progress|undefined>((best,task)=>!best||rank(task)>rank(best)||
    (rank(task)===rank(best)&&(task.updated??'')>=(best.updated??''))?task:best,undefined);
}

export function ContinuationProgress({tasks,error,onAction,embedded=false}:{embedded?:boolean;tasks:Progress[];error:string;onAction:(operation:string,task?:string)=>Promise<unknown>}) {
  useInterfaceLanguage();const [busy,setBusy]=useState(false);
  const [preview,setPreview]=useState<{task:string;proposals:{index:number;action:string;current_text:string|null;after:string}[]}|null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const task=currentTask(tasks.filter(task => task.state !== 'completed' || !hidden.includes(task.task_id)));
  const canOperate=!!task&&(task.is_current||!!task.project_target);
  if(!task&&!error)return null;
  if(embedded&&!error&&task?.state!=='paused'&&!task?.staged&&!task?.held_batches)return null;
  const run=async(operation:string,id?:string)=>{if(operation!=='tasks')setPreview(null);setBusy(true);try{await onAction(operation,id);}catch{/* Parent retains the actionable error. */}finally{setBusy(false);}};
  const showProposals=async(id:string)=>{setBusy(true);try{const result=await onAction('proposals',id) as {proposals:NonNullable<typeof preview>['proposals']};setPreview({task:id,proposals:result.proposals});}catch{/* Parent exposes recovery. */}finally{setBusy(false);}};
  const message=task?(!canOperate?msg('continuation.openVersion'):task.state==='paused'?(task.reason==='user_paused'?msg('continuation.paused'):task.reason==='planned_segment_changed'?msg('continuation.scopeChanged'):task.reason==='batch_conflict_manual_changes_preserved'?msg('continuation.conflict'):msg('continuation.savePaused')):task.state==='completed'?msg('continuation.completed'):task.staged?msg('continuation.staged',{count:task.staged}):msg('continuation.ready')):'';
  const live=task?.state==='draft';
  return <section className={`continuation-progress${live&&!embedded?' is-running':''}${embedded?' is-embedded':''}`} aria-label={msg('continuation.title')}>
    <div className="continuation-progress-row">
      {!embedded&&<><strong className="continuation-progress-title">{msg('continuation.title')}</strong>
      {task&&<>
        <span className="continuation-progress-version" title={task.project_target ? `${task.project_target.interview} · ${task.project_target.recording} · ${task.version}` : task.version}>{task.project_target ? `${task.project_target.recording} · ${task.version}` : task.version}</span>
        <span className="continuation-progress-data" role="status" aria-live="polite">
          {task.batch_number!==undefined&&task.state!=='completed'&&<span>{msg('continuation.batch',{batch:task.batch_number})}</span>}
          {task.saved_batches!==undefined&&task.state==='completed'&&<span>{msg('continuation.batchesSaved',{count:task.saved_batches})}</span>}
          <span>{msg('continuation.saved',{saved:task.saved_segments,total:task.total_segments})}</span>
        </span>
      </>}
      </>}
      <div className="continuation-progress-actions">
        {(!embedded||task?.state==='paused'||error)&&<button className="cred-btn" type="button" disabled={busy} onClick={()=>void run('tasks')}>{msg('continuation.refresh')}</button>}
        {task&&<>
          {!embedded&&task.state==='completed'&&!task.staged&&!task.held_batches&&<button type="button" className="feedback-dismiss" aria-label={msg('notice.dismiss')} onClick={() => setHidden(ids => [...ids, ...tasks.filter(item => item.state === 'completed').map(item => item.task_id)])}>×</button>}
          {(task.staged>0||task.held_batches>0)&&<button type="button" className="cred-btn" disabled={busy||!canOperate} onClick={()=>void showProposals(task.task_id)}>{msg('continuation.viewPending')}</button>}
          {!embedded&&task.state==='draft'&&<button type="button" className="cred-btn" disabled={busy||!canOperate} onClick={()=>void run('pause',task.task_id)}>{msg('continuation.pause')}</button>}
          {task.state==='paused'&&task.reason!=='planned_segment_changed'&&<button type="button" className="cred-btn" disabled={busy||!canOperate} onClick={()=>void run('resume',task.task_id)}>{msg('continuation.resume')}</button>}
          {!embedded&&task.state!=='completed'&&<button type="button" className="cred-btn" disabled={busy||!canOperate} onClick={()=>void run('cancel',task.task_id)}>{msg('continuation.cancel')}</button>}
        </>}
      </div>
    </div>
    {error&&<p className="continuation-progress-error" role="alert">{msg(error==='continuation_journal_unreadable'?'continuation.unreadableJournals':'continuation.error')}</p>}
    {task&&(!embedded||task.state==='paused')&&<p className="continuation-progress-note"><span>{message}</span>{live&&task.is_current&&<span className="continuation-progress-caution"> {msg('continuation.caution')}</span>}{task.held_batches>0&&<span> {msg('continuation.held')}</span>}</p>}
    {canOperate&&task&&(task.staged>0||task.held_batches>0)&&preview?.task===task.task_id&&<div className="continuation-proposals">
      <button type="button" className="cred-btn" onClick={()=>setPreview(null)}>{msg('continuation.hidePending')}</button>
      {!preview.proposals.length&&<p>{msg('continuation.noPending')}</p>}
      {preview.proposals.map((proposal,index)=><div key={index}>
        <strong>{proposal.index?msg('continuation.segment',{index:proposal.index}):msg('continuation.removedSegment')}</strong>
        <p>{msg('continuation.currentText')}</p><pre>{proposal.current_text??msg('continuation.removedSegment')}</pre>
        <p>{proposal.action==='delete'?msg('continuation.proposedDelete'):proposal.action==='merge_previous'?msg('continuation.proposedMerge'):msg('continuation.proposedText')}</p>
        {proposal.action!=='delete'&&<pre>{proposal.after}</pre>}
      </div>)}
    </div>}
  </section>;
}
