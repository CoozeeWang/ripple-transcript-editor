import {useState} from 'react';
import {msg, useInterfaceLanguage, uiMessage} from '../i18n';
import {TagModal} from './TagModal';
import type {TreeOrderPlan} from '../lib/projectTreeOrder';
import {recordProblem} from '../lib/diagnostics';
function tagStorageUpgradeError(error:unknown) {
    const code=typeof error==='string'?error:(error as {message?:string})?.message;
    return msg(code==='tag_order_baseline_required'?'tags.orderBaselineNotice':code==='tag_order_baseline_changed'||code==='project_changed'?'tags.orderSourceChanged':code==='tag_backup_directory_not_empty'?'tags.storageBackupNotEmpty':code==='tag_backup_must_be_outside_project'?'tags.storageBackupOutside':code==='tag_migration_source_changed'?'tags.storageBackupSourceChanged':code==='tag_backup_verification_failed'?'tags.storageBackupVerificationFailed':'tags.storageUpgradeFailed');
}
export function TagStorageUpgrade({onUpgrade,onInspect}:{onUpgrade?:(options?:{orderBaseline?:string;expectedRevision?:number})=>Promise<void>;onInspect?:()=>Promise<TreeOrderPlan & {projectRevision:number}>}){
    useInterfaceLanguage();
    const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[baseline,setBaseline]=useState('');
    const [plan,setPlan]=useState<(TreeOrderPlan&{projectRevision:number})|null>(null);
    return <><p className="annotation-empty">{msg('tags.storageUpgradeRequired')}</p>
        {onUpgrade&&<button type="button" className="button button--secondary" onClick={()=>{setOpen(true);setError('');setPlan(null);setBaseline('');if(onInspect){setBusy(true);void onInspect().then(setPlan,error=>setError(tagStorageUpgradeError(error))).finally(()=>setBusy(false))}}}>{msg('tags.storageUpgrade')}</button>}
        {open&&<TagModal compact title={msg('tags.storageUpgrade')} onClose={()=>{if(!busy)setOpen(false)}}>
            <p className="settings-hint">{msg('tags.storageUpgradeNotice')}</p><p className="settings-hint">{msg('tags.storageRollbackLimit')}</p>
            {plan?.conflict&&<label className="field"><span>{msg('tags.orderBaselineNotice')}</span><select aria-label={msg('tags.orderBaselineLabel')} value={baseline} disabled={busy} onChange={event=>setBaseline(event.target.value)}><option value="">{msg('tags.orderBaselineChoose')}</option>{plan.sources.map(source=><option key={source.id} value={source.id}>{source.label}</option>)}</select></label>}
            {plan&&!plan.conflict&&<p className="settings-hint">{msg('tags.orderPreserveNotice')}</p>}
            {error&&<p role="alert" className="tag-error">{uiMessage(error)}</p>}
            <div className="project-actions audio-project-footer"><button type="button" data-cancel className="button button--secondary" disabled={busy} onClick={()=>setOpen(false)}>{msg('tags.cancel')}</button>
                <button type="button" className="button button--primary" disabled={busy||!!onInspect&&!plan||!!plan?.conflict&&!baseline} onClick={()=>{setBusy(true);setError('');void onUpgrade?.({orderBaseline:baseline||undefined,expectedRevision:plan?.projectRevision}).then(()=>setOpen(false),e=>{if((e as {name?:string}).name!=='AbortError'){recordProblem('save',e);setError(tagStorageUpgradeError(e))}}).finally(()=>setBusy(false))}}>{msg(busy?'tags.storageUpgrading':'tags.storageBackupAndUpgrade')}</button></div>
        </TagModal>}
    </>;
}
