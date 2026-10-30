import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IS_MAC } from '../lib/format';
import './tooltips.css';

type Hint = { target: HTMLElement; described: HTMLElement; text: string; kind: 'control' | 'action' };
const selector = '[data-action-tip],[data-tip]';

/** One window-wide lifecycle for explicit hints, including dialogs and portals. */
export function TooltipHost() {
    const [hint, setHint] = useState<Hint | null>(null), popup = useRef<HTMLDivElement>(null), id = useId();
    const session = useRef({ target: null as HTMLElement | null, overTrigger: false, overTip: false, focus: false, suppressed: false, modifier: false });
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined, leaveTimer: ReturnType<typeof setTimeout> | undefined;
        const clear = () => { clearTimeout(timer); clearTimeout(leaveTimer); };
        const hide = (suppress = false) => { clear(); if (suppress) session.current.suppressed = true; setHint(null); };
        const reset = () => { hide(); session.current.target = null; session.current.suppressed = false; session.current.overTrigger = false; session.current.overTip = false; session.current.focus = false; };
        const targetFor = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>(selector) : null;
        const allowed = (target: HTMLElement) => target.dataset.tooltipDisabled !== 'true' && !!(target.dataset.actionTip || target.dataset.tip);
        const choose = (target: HTMLElement) => {
            if (session.current.target !== target) { clear(); session.current.target = target; session.current.suppressed = false; session.current.overTip = false; session.current.focus = false; setHint(null); }
        };
        const show = () => {
            const s = session.current, target = s.target;
            if (!target?.isConnected || !allowed(target) || s.suppressed || s.modifier || (!s.overTrigger && !s.focus)) return;
            const described = s.focus && document.activeElement instanceof HTMLElement && target.contains(document.activeElement) ? document.activeElement : target;
            setHint({ target, described, text: target.dataset.actionTip || target.dataset.tip!, kind: target.dataset.actionTip ? 'action' : 'control' });
        };
        const arm = (keyboard = false) => {
            clearTimeout(timer);
            if (keyboard) show();
            else timer = setTimeout(show, session.current.target?.hasAttribute('data-action-tip') ? 800 : 600);
        };
        const leave = () => {
            clearTimeout(timer); clearTimeout(leaveTimer);
            leaveTimer = setTimeout(() => { const s = session.current; if (!s.overTrigger && !s.overTip && !s.focus) reset(); }, 160);
        };
        const pointerOver = (event: PointerEvent) => {
            const element = event.target instanceof Element ? event.target : null;
            if (element?.closest('[data-shared-tooltip]')) { session.current.overTip = true; clearTimeout(leaveTimer); return; }
            const target = targetFor(event.target);
            if (!target || !allowed(target)) return;
            const wasSame = session.current.target === target && session.current.overTrigger;
            choose(target); const s = session.current; if (!s.overTrigger && !s.overTip) s.suppressed = false; s.overTrigger = true; clearTimeout(leaveTimer);
            const mac = target.dataset.tipModifier ? target.dataset.tipModifier === 'Meta' : IS_MAC;
            if (mac ? event.metaKey : event.ctrlKey) { s.modifier = true; s.suppressed = true; }
            if (!wasSame) arm();
        };
        const pointerOut = (event: PointerEvent) => {
            const s = session.current, next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
            if (event.target instanceof Element && event.target.closest('[data-shared-tooltip]')) {
                if (!popup.current?.contains(next)) { s.overTip = false; leave(); }
            }
            if (s.target?.contains(event.target as Node) && !s.target.contains(next)) { s.overTrigger = false; leave(); }
        };
        const pointerMove = (event: PointerEvent) => {
            const s = session.current;
            if (s.target && !allowed(s.target)) { hide(true); return; }
            if (s.overTrigger && !popup.current && targetFor(event.target) === s.target) arm();
        };
        const focusIn = (event: FocusEvent) => {
            const target = targetFor(event.target);
            if (!target || !allowed(target)) { session.current.focus = false; hide(); return; }
            choose(target); if (!session.current.overTrigger) session.current.suppressed = false;
            if ((event.target instanceof Element && event.target.matches(':focus-visible')) || target.matches(':focus-visible')) { session.current.focus = true; arm(true); }
        };
        const focusOut = (event: FocusEvent) => { const s = session.current; if (s.target?.contains(event.target as Node)) { s.focus = false; hide(); } };
        const keyDown = (event: KeyboardEvent) => {
            const key = session.current.target?.dataset.tipModifier || (IS_MAC ? 'Meta' : 'Control');
            if (event.key === key) session.current.modifier = true;
            if (event.key === 'Escape' || event.key === key) hide(true);
        };
        const keyUp = (event: KeyboardEvent) => { if (event.key === 'Meta' || event.key === 'Control') session.current.modifier = false; };
        const dismiss = () => hide(true);
        const scroll = (event: Event) => { if (event.target instanceof Node && popup.current?.contains(event.target)) return; dismiss(); };
        const blur = () => { session.current.modifier = false; session.current.focus = false; hide(true); };
        document.addEventListener('pointerover', pointerOver); document.addEventListener('pointerout', pointerOut); document.addEventListener('pointermove', pointerMove);
        document.addEventListener('focusin', focusIn); document.addEventListener('focusout', focusOut);
        document.addEventListener('pointerdown', dismiss, true); document.addEventListener('click', dismiss, true); document.addEventListener('dragstart', dismiss, true);
        window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp, true); window.addEventListener('blur', blur);
        window.addEventListener('scroll', scroll, true); window.addEventListener('resize', dismiss);
        return () => {
            clear(); document.removeEventListener('pointerover', pointerOver); document.removeEventListener('pointerout', pointerOut); document.removeEventListener('pointermove', pointerMove);
            document.removeEventListener('focusin', focusIn); document.removeEventListener('focusout', focusOut);
            document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('click', dismiss, true); document.removeEventListener('dragstart', dismiss, true);
            window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', blur);
            window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', dismiss);
        };
    }, []);
    useLayoutEffect(() => {
        const element = popup.current;
        if (!hint || !element) return;
        if (element.showPopover) element.showPopover(); else element.style.display = 'block';
        const previous = hint.described.getAttribute('aria-describedby');
        hint.described.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '));
        const position = () => {
            if (!hint.target.isConnected) return;
            const anchor = hint.target.querySelector<HTMLElement>('[data-tip-anchor]') ?? hint.target;
            const a = anchor.getBoundingClientRect(), b = element.getBoundingClientRect(), edge = 8, gap = 8;
            let left: number, top: number, placement: string;
            if (hint.kind === 'action') {
                if (a.right + gap + b.width <= innerWidth - edge) { left = a.right + gap; top = a.top + (a.height - b.height) / 2; placement = 'right'; }
                else if (a.top - gap - b.height >= edge) { left = a.left; top = a.top - gap - b.height; placement = 'top'; }
                else { left = a.left - gap - b.width; top = a.top + (a.height - b.height) / 2; placement = 'left'; }
            } else {
                const upwards = hint.target.dataset.tipPos === 'top' || a.bottom + gap + b.height > innerHeight - edge;
                left = a.left + (a.width - b.width) / 2; top = upwards ? a.top - gap - b.height : a.bottom + gap; placement = upwards ? 'top' : 'bottom';
            }
            element.style.left = `${Math.max(edge, Math.min(left, innerWidth - edge - b.width))}px`;
            element.style.top = `${Math.max(edge, Math.min(top, innerHeight - edge - b.height))}px`;
            element.dataset.placement = placement; element.style.visibility = 'visible';
        };
        const detached = new MutationObserver(() => { if (!hint.target.isConnected || hint.target.dataset.tooltipDisabled === 'true') setHint(null); });
        detached.observe(document.body, { childList: true, subtree: true }); detached.observe(hint.target, { attributes: true, attributeFilter: ['data-tooltip-disabled'] });
        position(); const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position); observer?.observe(hint.target); observer?.observe(element);
        return () => {
            observer?.disconnect(); detached.disconnect();
            if (previous === null) hint.described.removeAttribute('aria-describedby'); else hint.described.setAttribute('aria-describedby', previous);
        };
    }, [hint, id]);
    if (!hint?.target.isConnected) return null;
    const container = hint.target.closest('dialog[open]') ?? document.body;
    return createPortal(<div ref={popup} id={id} role="tooltip" popover="manual" data-shared-tooltip className={`ripple-tooltip ripple-tooltip--${hint.kind}`} style={{ visibility: 'hidden' }}>{hint.text}</div>, container);
}
