import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { trapDialogFocus } from '../lib/dialogFocus';
export function TagModal({ title, onClose, children }: {
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null), opener = useRef(document.activeElement), id = useId();
    useLayoutEffect(() => { const dialog = ref.current!, previous = opener.current; dialog.showModal(); dialog.querySelector<HTMLElement>('[data-cancel]')?.focus(); return () => { dialog.close(); queueMicrotask(() => { if (document.querySelector('dialog[open]'))
        return; if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    else
        document.querySelector<HTMLElement>('.panel-tabs button:last-child')?.focus(); }); }; }, []);
    return <dialog ref={ref} className="material-preview-dialog audio-project-dialog tag-dialog" aria-labelledby={id} onKeyDown={trapDialogFocus} onCancel={e => { e.preventDefault(); onClose(); }}><div className="dialog-header"><h2 id={id}>{title}</h2></div>{children}</dialog>;
}
