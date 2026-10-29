/**
 * macOS filters a copy-only WKWebView drag to NSDragOperationNone while Cmd
 * is held. Keep negotiation available until the pointer is released. This is
 * an export source: it never removes or moves the manuscript on dragend.
 * The destination chooses its final operation; copy is the default preference.
 * Only interoperable DOM types go here. text/rtf becomes private WebKit data,
 * not public.rtf; native clipboard copying provides the actual RTF separately.
 */
export type SegmentDragWriter = Pick<DataTransfer, 'clearData' | 'setData' | 'effectAllowed' | 'dropEffect'>;
export function populateSegmentDrag(transfer: SegmentDragWriter, payload: {plain: string; html: string}) {
  transfer.clearData();
  transfer.setData('text/plain', payload.plain);
  transfer.setData('text/html', payload.html);
  transfer.effectAllowed = 'all';
  transfer.dropEffect = 'copy';
}
