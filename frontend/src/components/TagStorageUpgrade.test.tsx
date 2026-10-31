// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TagStorageUpgrade} from './TagStorageUpgrade';
import {msg} from '../i18n';
beforeEach(()=>{
 HTMLDialogElement.prototype.showModal=function(){this.open=true};
 HTMLDialogElement.prototype.close=function(){this.open=false};
});
afterEach(()=>{cleanup();localStorage.clear()});
it.each([
 ['tag_backup_directory_not_empty','tags.storageBackupNotEmpty'],
 ['tag_backup_must_be_outside_project','tags.storageBackupOutside'],
 ['tag_backup_verification_failed','tags.storageBackupVerificationFailed'],
 ['tag_migration_source_changed','tags.storageBackupSourceChanged'],
])('explains %s without retrying or overwriting the chosen backup',async(code,key)=>{
 const upgrade=vi.fn().mockRejectedValue(Error(code));render(<TagStorageUpgrade onUpgrade={upgrade}/>);
 fireEvent.click(screen.getByRole('button',{name:msg('tags.storageUpgrade')}));
 expect(upgrade).not.toHaveBeenCalled();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:msg('tags.storageBackupAndUpgrade')})));
 expect(screen.getByRole('alert').textContent).toBe(msg(key));expect(upgrade).toHaveBeenCalledOnce();
 expect((screen.getByRole('button',{name:msg('tags.cancel')})as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:msg('tags.cancel')}));expect(document.querySelector('dialog')).toBeNull();expect(upgrade).toHaveBeenCalledOnce();
});
