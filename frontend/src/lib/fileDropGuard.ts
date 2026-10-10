/** Prevent WebView/browser file navigation on every page, including disabled drop targets. */
export function installFileDropGuard(target: Window = window): () => void {
  const preventFileNavigation = (event: DragEvent) => {
    const transfer = event.dataTransfer;
    if (transfer && (Array.from(transfer.types).includes('Files')
      || Array.from(transfer.items ?? []).some(item => item.kind === 'file'))) {
      // Capture before an import target can stop propagation. Do not stop the
      // event: valid targets retain their own import and dropEffect handling.
      event.preventDefault();
    }
  };
  target.addEventListener('dragover', preventFileNavigation, true);
  target.addEventListener('drop', preventFileNavigation, true);
  return () => {
    target.removeEventListener('dragover', preventFileNavigation, true);
    target.removeEventListener('drop', preventFileNavigation, true);
  };
}
