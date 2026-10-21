// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { reservePdfWindow, showPdfPrintPreview } from './pdfPrint';
import { setInterfaceLanguage } from '../i18n';

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  vi.restoreAllMocks();
  vi.useRealTimers();
  setInterfaceLanguage('zh-CN');
});

it('opens the desktop preview through the native command without a browser popup or HTML download', async () => {
  const invoke = vi.fn().mockResolvedValue(undefined);
  Object.assign(window, { __TAURI__: { core: { invoke } } });
  const open = vi.spyOn(window, 'open');
  expect(reservePdfWindow()).toBeNull();
  await showPdfPrintPreview('<html>synthetic</html>', 'Synthetic');
  expect(invoke).toHaveBeenCalledWith('preview_export_pdf', {
    html: '<html>synthetic</html>', title: 'Synthetic', errorLabel: '无法打开打印窗口，请点击“打印”重试。',
  });
  expect(open).not.toHaveBeenCalled();
});

it.each(['zh-CN', 'en'] as const)('reports a native preview failure in %s', async language => {
  setInterfaceLanguage(language);
  Object.assign(window, { __TAURI__: { core: { invoke: vi.fn().mockRejectedValue(new Error('native_failure')) } } });
  await expect(showPdfPrintPreview('synthetic', 'Synthetic')).rejects.toThrow(
    language === 'en' ? 'Couldn’t open print preview. Try exporting again.' : '无法打开打印预览，请重新导出。',
  );
});

it('reports a blocked browser popup instead of exporting an HTML substitute', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  await expect(showPdfPrintPreview('synthetic', 'Synthetic')).rejects.toThrow();
});

it('prints a previously reserved browser window after filling the document', async () => {
  vi.useFakeTimers();
  const popup = { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn(), closed: false };
  const open = vi.spyOn(window, 'open');
  await showPdfPrintPreview('synthetic', 'Synthetic', popup as unknown as Window);
  expect(popup.document.write).toHaveBeenCalledWith('synthetic');
  await vi.advanceTimersByTimeAsync(300);
  expect(popup.print).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
});
