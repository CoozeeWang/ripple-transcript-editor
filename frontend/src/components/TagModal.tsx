import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { trapDialogFocus } from '../lib/dialogFocus';
export function TagModal({ title, descriptionId, onClose, children }: {
    title: string;
    descriptionId?: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null), opener = useRef(document.activeElement), outsidePress = useRef(false), id = useId();
    useLayoutEffect(() => { const dialog = ref.current!, previous = opener.current; dialog.showModal(); dialog.querySelector<HTMLElement>('[data-dialog-initial-focus], [data-cancel]')?.focus(); return () => { dialog.close(); queueMicrotask(() => { if (document.querySelector('dialog[open]'))
        return; if (previous instanceof HTMLElement && previous.isConnected && !previous.matches(':disabled'))
        previous.focus();
    else
        document.querySelector<HTMLElement>('.tag-library .group-toggle:not(:disabled), .tag-library .library-filter:not(:disabled), .tag-library .tag-filter-toggle:not(:disabled), .panel-tabs button.is-active')?.focus(); }); }; }, []);
    function outside(x: number, y: number) { const rect = ref.current!.getBoundingClientRect(); return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom; }
    return <dialog ref={ref} className="material-preview-dialog audio-project-dialog tag-dialog" aria-labelledby={id} aria-describedby={descriptionId}
        onPointerDown={e => { outsidePress.current = e.target === e.currentTarget && outside(e.clientX, e.clientY); }}
        onClick={e => { const dismiss = outsidePress.current && e.target === e.currentTarget && outside(e.clientX, e.clientY); outsidePress.current = false; if (dismiss) onClose(); }}
        onKeyDown={trapDialogFocus} onCancel={e => { e.preventDefault(); onClose(); }}><div className="dialog-header"><h2 id={id}>{title}</h2></div>{children}</dialog>;
}
