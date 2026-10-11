import { afterEach, expect, it, vi } from 'vitest';
import { setInterfaceLanguage } from '../i18n';
import { installNativeMenuLanguage } from './nativeMenu';
afterEach(async () => { await setInterfaceLanguage('zh-CN'); });
it('updates native menu labels immediately and on each language change', async () => {
  const invoke = vi.fn(async () => true);
  const remove = installNativeMenuLanguage(invoke);
  expect(invoke).toHaveBeenLastCalledWith('set_menu_language', { labels: expect.objectContaining({File:'文件',Copy:'复制',About:'关于 __APP_NAME__'}) });
  await setInterfaceLanguage('en');
  expect(invoke).toHaveBeenLastCalledWith('set_menu_language', { labels: expect.objectContaining({File:'File',Copy:'Copy',About:'About __APP_NAME__'}) });
  remove(); await setInterfaceLanguage('zh-CN');
  expect(invoke).toHaveBeenCalledTimes(2);
});
