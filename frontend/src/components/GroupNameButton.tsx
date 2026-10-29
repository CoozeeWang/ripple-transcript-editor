import { useEffect, useLayoutEffect, useRef, useState, useId, useCallback, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { msg } from '../i18n';
import { createPortal } from 'react-dom';
// Local to draggable group names; the editor's other tooltips are unchanged.
export function GroupNameButton({ isMac, dragging, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    isMac: boolean;
    dragging: boolean;
    children: ReactNode;
}) {
    const button = useRef<HTMLButtonElement>(null), tip = useRef<HTMLSpanElement>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null), leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const session = useRef({ hover: false, focus: false, suppressed: false, modifier: false });
    const [open, setOpen] = useState(false), [position, setPosition] = useState<{
        left: number;
        top: number;
        side: string;
    } | null>(null), id = useId();
    const clear = useCallback(() => { clearTimeout(timer.current ?? undefined); clearTimeout(leaveTimer.current ?? undefined); }, []);
    const dismiss = useCallback(() => { clear(); session.current.suppressed = true; setOpen(false); setPosition(null); }, [clear]);
    function arm() { clearTimeout(timer.current ?? undefined); const s = session.current; if (s.suppressed || s.modifier || dragging)
        return; timer.current = setTimeout(() => { if ((s.hover || s.focus) && !s.suppressed && !s.modifier) {
        setPosition(null);
        setOpen(true);
    } }, 800); }
    function leave() { session.current.hover = false; clearTimeout(timer.current ?? undefined); leaveTimer.current = setTimeout(() => { if (!session.current.hover) {
        setOpen(false);
        setPosition(null);
    } }, 160); }
    useEffect(() => {
        const down = (e: KeyboardEvent) => { if (e.key === (isMac ? 'Meta' : 'Control'))
            session.current.modifier = true; if (e.key === 'Escape' || session.current.modifier)
            dismiss(); };
        const up = (e: KeyboardEvent) => { if (e.key === (isMac ? 'Meta' : 'Control'))
            session.current.modifier = false; };
        const blur = () => { session.current.modifier = false; session.current.focus = false; dismiss(); };
        const cancel = () => dismiss();
        window.addEventListener('keydown', down, true);
        window.addEventListener('keyup', up, true);
        window.addEventListener('blur', blur);
        window.addEventListener('pointerdown', cancel, true);
        window.addEventListener('dragstart', cancel, true);
        window.addEventListener('scroll', cancel, true);
        window.addEventListener('resize', cancel);
        return () => { clear(); window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); window.removeEventListener('pointerdown', cancel, true); window.removeEventListener('dragstart', cancel, true); window.removeEventListener('scroll', cancel, true); window.removeEventListener('resize', cancel); };
    }, [isMac, dismiss, clear]);
    useEffect(() => { if (!dragging)
        return; const timer = setTimeout(dismiss, 0); return () => clearTimeout(timer); }, [dragging, dismiss]);
    useLayoutEffect(() => {
        if (!open || !tip.current || !button.current)
            return;
        const a = button.current.getBoundingClientRect(), t = tip.current.getBoundingClientRect(), gap = 8, edge = 8;
        const right = a.right + gap + t.width <= innerWidth - edge;
        // Portal avoids clipping in the scrolling tree. Never place below a group.
        const left = Math.max(edge, Math.min(right ? a.right + gap : a.left, innerWidth - edge - t.width));
        const top = Math.max(edge, Math.min(right ? a.top + (a.height - t.height) / 2 : a.top - gap - t.height, innerHeight - edge - t.height));
        setPosition({ left, top, side: right ? 'right' : 'top' });
    }, [open]);
    return <><button {...props} ref={button} aria-describedby={open ? id : props['aria-describedby']} onPointerEnter={e => { clearTimeout(leaveTimer.current ?? undefined); const s = session.current; s.hover = true; s.suppressed = false; s.modifier = isMac ? e.metaKey : e.ctrlKey; if (s.modifier)
        s.suppressed = true; arm(); }} onPointerLeave={leave} onPointerMove={e => { props.onPointerMove?.(e); if (!open && session.current.hover)
        arm(); }} onFocus={e => { session.current.focus = true; if (e.currentTarget.matches(':focus-visible')) {
        session.current.suppressed = false;
        arm();
    } }} onBlur={() => { session.current.focus = false; dismiss(); }} onClick={e => { dismiss(); props.onClick?.(e); }}>{children}</button>
  {open && createPortal(<span ref={tip} id={id} role="tooltip" className="group-name-tooltip" data-placement={position?.side} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }} onPointerEnter={() => { clearTimeout(leaveTimer.current ?? undefined); session.current.hover = true; }} onPointerLeave={leave}>{msg('tags.drag', { key: isMac ? '⌘' : 'Ctrl' })}</span>, document.body)}
 </>;
}
