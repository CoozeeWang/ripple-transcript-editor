import {useState} from 'react';
import {msg,useInterfaceLanguage} from '../i18n';
import type {ContinuationProgress as Progress} from '../lib/incrementalContinuation';

export function ContinuationProgress({tasks,error,onAction}:{tasks:Progress[];error:string;onAction:(operation:string,task?:string)=>Promise<unknown>}) {
  useInterfaceLanguage();const [busy,setBusy]=useState(false);
  const [preview,setPreview]=useState<{task:string;proposals:{index:number;action:string;current_text:string|null;after:string}[]}|null>(null);
  const active=tasks.filter(t=>t.state!=='cancelled');
  if(!active.length&&!error)return null;
  const run=async(operation:string,id?:string)=>{setBusy(true);try{await onAction(operation,id);}catch{/* Parent retains the actionable error. */}finally{setBusy(false);}};
  const showProposals=async(id:string)=>{setBusy(true);try{const result=await onAction('proposals',id) as {proposals:NonNullable<typeof preview>['proposals']};setPreview({task:id,proposals:result.proposals});}catch{/* Parent exposes recovery. */}finally{setBusy(false);}};
  return <section className="continuation-progress" aria-label={msg('continuation.title')}>
    <div className="continuation-progress-heading"><strong>{msg('continuation.title')}</strong><button className="cred-btn" type="button" disabled={busy} onClick={()=>void run('tasks')}>{msg('continuation.refresh')}</button></div>
    {error&&<p role="alert">{msg('continuation.error')}</p>}
    {active.map(task=><div className="continuation-progress-task" key={task.task_id}>
      <div><strong>{task.version}</strong><span role="status">{msg('continuation.saved',{saved:task.saved_segments,total:task.total_segments})}</span></div>
      <p>{!task.is_current?msg('continuation.openVersion'):task.state==='paused'?(task.reason==='user_paused'?msg('continuation.paused'):task.reason==='planned_segment_changed'?msg('continuation.scopeChanged'):task.reason==='batch_conflict_manual_changes_preserved'?msg('continuation.conflict'):msg('continuation.savePaused')):task.state==='completed'?msg('continuation.completed'):task.staged?msg('continuation.staged',{count:task.staged}):msg('continuation.ready')}</p>
      {task.held_batches>0&&<p>{msg('continuation.held')}</p>}
      <div className="continuation-progress-actions">
        {(task.staged>0||task.held_batches>0)&&<button type="button" className="cred-btn" disabled={busy||!task.is_current} onClick={()=>void showProposals(task.task_id)}>{msg('continuation.viewPending')}</button>}
        {task.state==='draft'&&<button type="button" className="cred-btn" disabled={busy||!task.is_current} onClick={()=>void run('pause',task.task_id)}>{msg('continuation.pause')}</button>}
        {task.state==='paused'&&task.reason!=='planned_segment_changed'&&<button type="button" className="cred-btn" disabled={busy||!task.is_current} onClick={()=>void run('resume',task.task_id)}>{msg('continuation.resume')}</button>}
        {task.state!=='completed'&&<button type="button" className="cred-btn" disabled={busy||!task.is_current} onClick={()=>void run('cancel',task.task_id)}>{msg('continuation.cancel')}</button>}
      </div>
      {preview?.task===task.task_id&&<div className="continuation-proposals">
        <button type="button" className="cred-btn" onClick={()=>setPreview(null)}>{msg('continuation.hidePending')}</button>
        {!preview.proposals.length&&<p>{msg('continuation.noPending')}</p>}
        {preview.proposals.map((proposal,index)=><div key={index}>
          <strong>{proposal.index?msg('continuation.segment',{index:proposal.index}):msg('continuation.removedSegment')}</strong>
          <p>{msg('continuation.currentText')}</p><pre>{proposal.current_text??msg('continuation.removedSegment')}</pre>
          <p>{proposal.action==='delete'?msg('continuation.proposedDelete'):proposal.action==='merge_previous'?msg('continuation.proposedMerge'):msg('continuation.proposedText')}</p>
          {proposal.action!=='delete'&&<pre>{proposal.after}</pre>}
        </div>)}
      </div>}
    </div>)}
  </section>;
}
