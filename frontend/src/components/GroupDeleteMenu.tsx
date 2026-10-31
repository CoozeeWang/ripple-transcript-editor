import { useId, useLayoutEffect, useRef, useState } from 'react';
import { msg } from '../i18n';
import { useDismissable } from '../useDismissable';
import { ActionIcon } from './ActionIcon';
import './languageControl.css';

/** Same top-layer menu and dismissal contract as the language control. */
export function GroupDeleteMenu({ name, disabled, onChoose }: {
    name: string;
    disabled: boolean;
    onChoose: (scope: 'tree' | 'level') => void;
}) {
    const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), id = useId();
    useDismissable(root, open, () => setOpen(false));
    useLayoutEffect(() => {
        if (!open || !menu.current || !trigger.current) return;
        const popup = menu.current;
        if (popup.showPopover) popup.showPopover(); else popup.style.display = 'block';
        const position = () => {
            const rect = trigger.current!.getBoundingClientRect();
            popup.style.left = `${Math.max(8, Math.min(rect.right - popup.offsetWidth, window.innerWidth - popup.offsetWidth - 8))}px`;
            popup.style.top = `${Math.max(8, rect.bottom + 6 + popup.offsetHeight <= window.innerHeight - 8 ? rect.bottom + 6 : rect.top - popup.offsetHeight - 6)}px`;
        };
        position(); popup.querySelector<HTMLButtonElement>('button')?.focus();
        window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
        return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
    }, [open]);
    const choose = (scope: 'tree' | 'level') => { setOpen(false); trigger.current?.focus(); onChoose(scope); };
    return <div className="group-delete-control" ref={root} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault(); if (!open) { setOpen(true); return; }
            const options = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []), index = options.indexOf(document.activeElement as HTMLButtonElement);
            options[e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
        }
    }}>
        <button ref={trigger} type="button" className="group-delete" disabled={disabled} aria-label={`${msg('tags.deleteGroup')}: ${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={id} data-tip={msg('tags.deleteGroup')} onClick={() => setOpen(!open)}><ActionIcon kind="trash"/></button>
        {open && <div ref={menu} id={id} role="menu" popover="manual" className="language-menu group-delete-menu" aria-label={`${msg('tags.deleteGroup')}: ${name}`}>
            <button type="button" role="menuitem" onClick={() => choose('tree')}>{msg('tags.deleteGroupTree')}</button>
            <button type="button" role="menuitem" onClick={() => choose('level')}>{msg('tags.deleteGroupLevel')}</button>
        </div>}
    </div>;
}
