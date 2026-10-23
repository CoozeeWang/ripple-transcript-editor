// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { setInterfaceLanguage } from '../i18n';
import { installNativeMenuLanguage, nativeMenuLabels } from './nativeMenu';
afterEach(async () => { await setInterfaceLanguage('zh-CN'); });
it('updates native menu labels immediately and on each language change', async () => {
  const invoke = vi.fn(async () => true);
  const loadRecents = vi.fn(async () => [{id:'synthetic-one',title:'示例项目'}]);
  const remove = installNativeMenuLanguage(invoke, loadRecents);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(invoke).toHaveBeenLastCalledWith('set_menu_language', { language:'zh-CN', recentProjects:[{id:'synthetic-one',title:'示例项目'}], labels: expect.objectContaining({File:'文件','Open Project…':'打开项目…','Recent Projects':'最近项目',Copy:'复制',About:'关于 __APP_NAME__','Check for Updates…':'检查更新…'}) });
  await setInterfaceLanguage('en');
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(invoke).toHaveBeenLastCalledWith('set_menu_language', { language:'en', recentProjects:[{id:'synthetic-one',title:'示例项目'}], labels: expect.objectContaining({File:'File','Open Project…':'Open Project…','Recent Projects':'Recent Projects',Copy:'Copy',About:'About __APP_NAME__','Check for Updates…':'Check for Updates…'}) });
  window.dispatchEvent(new Event('ripple-recent-projects-changed'));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
  remove(); await setInterfaceLanguage('zh-CN');
  expect(invoke).toHaveBeenCalledTimes(3);
});

it('provides Taiwan labels and platform conventions without changing native actions',async()=>{
 await setInterfaceLanguage('zh-TW');
 const mac=nativeMenuLabels(true),windows=nativeMenuLabels(false);
 expect(mac).toMatchObject({Help:'輔助說明',Minimize:'縮到最小',Undo:'復原','Open Project…':'開啟專案…','Recent Projects':'最近專案','Check for Updates…':'檢查更新…','Software Update':'軟體更新'});
 expect(windows).toMatchObject({Help:'說明',Minimize:'最小化'});
 const invoke=vi.fn(async()=>true),remove=installNativeMenuLanguage(invoke, async()=>[]);
 await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
 expect(invoke).toHaveBeenLastCalledWith('set_menu_language',{language:'zh-TW',recentProjects:[],labels:expect.any(Object)});
 remove();
});
