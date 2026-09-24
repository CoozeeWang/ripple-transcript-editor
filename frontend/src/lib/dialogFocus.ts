import { useEffect, type KeyboardEvent, type RefObject } from 'react';

/** Focus a safe initial control and restore the still-connected opener. */
export function useDialogEntryFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [ref]);
}

/** Keep boundary Tab presses inside the modal instead of visiting browser chrome. */
export function trapDialogFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const dialog = event.currentTarget;
  if (!(event.target instanceof Element) || event.target.closest('dialog, [role="dialog"]') !== dialog) return;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled, [aria-disabled="true"]') && element.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}
