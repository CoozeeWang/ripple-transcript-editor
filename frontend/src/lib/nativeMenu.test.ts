import { afterEach, expect, it, vi } from 'vitest';
import { setInterfaceLanguage } from '../i18n';
import { installNativeMenuLanguage, nativeMenuLabels } from './nativeMenu';
afterEach(async () => { await setInterfaceLanguage('zh-CN'); });
it('updates native menu labels immediately and on each language change', async () => {
  const invoke = vi.fn(async () => true);
  const remove = installNativeMenuLanguage(invoke);
  expect(invoke).toHaveBeenLastCalledWith('set_menu_language', { language:'zh-CN', labels: expect.objectContaining({File:'文件',Copy:'复制',About:'关于 __APP_NAME__','Check for Updates…':'检查更新…'}) });
  await setInterfaceLanguage('en');
  expect(invoke).toHaveBeenLastCalledWith('set_menu_language', { language:'en', labels: expect.objectContaining({File:'File',Copy:'Copy',About:'About __APP_NAME__','Check for Updates…':'Check for Updates…'}) });
  remove(); await setInterfaceLanguage('zh-CN');
  expect(invoke).toHaveBeenCalledTimes(2);
});

it('provides Taiwan labels and platform conventions without changing native actions',async()=>{
 await setInterfaceLanguage('zh-TW');
 const mac=nativeMenuLabels(true),windows=nativeMenuLabels(false);
 expect(mac).toMatchObject({Help:'輔助說明',Minimize:'縮到最小',Undo:'復原','Check for Updates…':'檢查更新…','Software Update':'軟體更新'});
 expect(windows).toMatchObject({Help:'說明',Minimize:'最小化'});
 const invoke=vi.fn(async()=>true),remove=installNativeMenuLanguage(invoke);
 expect(invoke).toHaveBeenLastCalledWith('set_menu_language',{language:'zh-TW',labels:expect.any(Object)});
 remove();
});
