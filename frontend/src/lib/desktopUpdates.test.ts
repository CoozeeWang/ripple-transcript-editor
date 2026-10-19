import { expect,it } from 'vitest';
import { assertDesktopUpdateIdle,cancelDesktopUpdatePreparation,prepareDesktopUpdate,registerDesktopUpdateGuard } from './desktopUpdates';
it('fails closed with no workspace and propagates a guard rejection',async()=>{
  await expect(prepareDesktopUpdate()).rejects.toThrow('update_work_in_progress');
  const remove=registerDesktopUpdateGuard(async()=>{throw Error('update_unsaved_project');});
  await expect(prepareDesktopUpdate()).rejects.toThrow('update_unsaved_project');remove();
  await expect(prepareDesktopUpdate()).rejects.toThrow('update_work_in_progress');
});
it('blocks new external edits during preparation and releases the gate on failure',async()=>{
  const remove=registerDesktopUpdateGuard(async()=>{});
  await prepareDesktopUpdate();
  expect(()=>assertDesktopUpdateIdle()).toThrow('update_work_in_progress');
  await expect(prepareDesktopUpdate()).rejects.toThrow('update_work_in_progress');
  cancelDesktopUpdatePreparation();assertDesktopUpdateIdle();remove();
});
