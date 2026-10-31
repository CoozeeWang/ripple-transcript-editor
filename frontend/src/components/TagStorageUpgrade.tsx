import {useState} from 'react';
import {msg} from '../i18n';
import {TagModal} from './TagModal';
export function TagStorageUpgrade({onUpgrade}:{onUpgrade?:()=>Promise<void>}){
    const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
    return <><p className="annotation-empty">{msg('tags.storageUpgradeRequired')}</p>
        {onUpgrade&&<button type="button" className="button button--secondary" onClick={()=>setOpen(true)}>{msg('tags.storageUpgrade')}</button>}
        {open&&<TagModal compact title={msg('tags.storageUpgrade')} onClose={()=>{if(!busy)setOpen(false)}}>
            <p className="settings-hint">{msg('tags.storageUpgradeNotice')}</p>
            {error&&<p role="alert" className="tag-error">{error}</p>}
            <div className="project-actions audio-project-footer"><button type="button" data-cancel className="button button--secondary" disabled={busy} onClick={()=>setOpen(false)}>{msg('tags.cancel')}</button>
                <button type="button" className="button button--primary" disabled={busy} onClick={()=>{setBusy(true);setError('');void onUpgrade?.().then(()=>setOpen(false),e=>{if((e as {name?:string}).name!=='AbortError')setError(msg('tags.storageUpgradeFailed'))}).finally(()=>setBusy(false))}}>{msg(busy?'tags.storageUpgrading':'tags.storageBackupAndUpgrade')}</button></div>
        </TagModal>}
    </>;
}
