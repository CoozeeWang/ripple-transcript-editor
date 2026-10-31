import {useState} from 'react';
import {msg} from '../i18n';
import {TagModal} from './TagModal';
import {recordProblem} from '../lib/diagnostics';
function tagStorageUpgradeError(error:unknown) {
    const code=typeof error==='string'?error:(error as {message?:string})?.message;
    return msg(code==='tag_backup_directory_not_empty'?'tags.storageBackupNotEmpty':code==='tag_backup_must_be_outside_project'?'tags.storageBackupOutside':code==='tag_migration_source_changed'?'tags.storageBackupSourceChanged':code==='tag_backup_verification_failed'?'tags.storageBackupVerificationFailed':'tags.storageUpgradeFailed');
}
export function TagStorageUpgrade({onUpgrade}:{onUpgrade?:()=>Promise<void>}){
    const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
    return <><p className="annotation-empty">{msg('tags.storageUpgradeRequired')}</p>
        {onUpgrade&&<button type="button" className="button button--secondary" onClick={()=>setOpen(true)}>{msg('tags.storageUpgrade')}</button>}
        {open&&<TagModal compact title={msg('tags.storageUpgrade')} onClose={()=>{if(!busy)setOpen(false)}}>
            <p className="settings-hint">{msg('tags.storageUpgradeNotice')}</p><p className="settings-hint">{msg('tags.storageRollbackLimit')}</p>
            {error&&<p role="alert" className="tag-error">{error}</p>}
            <div className="project-actions audio-project-footer"><button type="button" data-cancel className="button button--secondary" disabled={busy} onClick={()=>setOpen(false)}>{msg('tags.cancel')}</button>
                <button type="button" className="button button--primary" disabled={busy} onClick={()=>{setBusy(true);setError('');void onUpgrade?.().then(()=>setOpen(false),e=>{if((e as {name?:string}).name!=='AbortError'){recordProblem('save',e);setError(tagStorageUpgradeError(e))}}).finally(()=>setBusy(false))}}>{msg(busy?'tags.storageUpgrading':'tags.storageBackupAndUpgrade')}</button></div>
        </TagModal>}
    </>;
}
