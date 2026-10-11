import { msg } from '../i18n';

type NativePrint = { core: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
function nativePrint(): NativePrint | undefined {
  return (window as unknown as { __TAURI__?: NativePrint }).__TAURI__;
}

export function nativePdfPrinting(): boolean { return Boolean(nativePrint()?.core?.invoke); }

/** Reserve the browser popup before asynchronous ZIP/document preparation. */
export function reservePdfWindow(): Window | null {
  if (nativePdfPrinting()) return null;
  const preview = window.open('', '_blank');
  if (!preview) throw new Error(msg('ProjectExportDialog.m0726'));
  return preview;
}

export async function showPdfPrintPreview(html: string, title: string, reserved?: Window | null): Promise<void> {
  const native = nativePrint();
  if (native?.core?.invoke) {
    try {
      await native.core.invoke('preview_export_pdf', { html, title, errorLabel: msg('export.pdfPrintError') });
    } catch {
      throw new Error(msg('export.pdfPreviewError'));
    }
    return;
  }
  const preview = reserved ?? reservePdfWindow();
  if (!preview || preview.closed) throw new Error(msg('ProjectExportDialog.m0726'));
  preview.document.open(); preview.document.write(html); preview.document.close(); preview.focus();
  window.setTimeout(() => { if (!preview.closed) preview.print(); }, 300);
}
