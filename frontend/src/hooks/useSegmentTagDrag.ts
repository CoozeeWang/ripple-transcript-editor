import { createContext, useEffect, useLayoutEffect, useMemo, useRef, type PointerEvent } from 'react';
import { segmentDragModifier } from './useSegmentDrag';
import { isEditorComposing } from '../lib/editorDrafts';

interface Options {
    context: string; enabled: boolean;
    canStart: (source: string, tag: string) => boolean;
    canDrop: (source: string, target: string, tag: string) => boolean;
    onTarget: (id: string | null) => void;
    onDrop: (tag: string, target: string) => Promise<void>;
    onError: (error: unknown) => void;
}
export interface SegmentTagDrag {
    enabled: () => boolean;
    canClick: () => boolean;
    start: (source: string, tag: string, name: string, event: PointerEvent<HTMLElement>) => void;
    move: (event: PointerEvent<HTMLElement>) => void;
    finish: (event: PointerEvent<HTMLElement>, commit?: boolean) => void;
}
export const SegmentTagDragContext = createContext<SegmentTagDrag | null>(null);

/** One transient tag ghost; movement never commits data or refreshes unrelated segment props. */
export function useSegmentTagDrag(options: Options): SegmentTagDrag {
    const latest = useRef(options), suppressed = useRef(0);
    const gesture = useRef<{ context: string; source: string; tag: string; name: string; pointer: number; element: HTMLElement; cursor: string;
        x: number; y: number; startX: number; startY: number; active: boolean; ghost?: HTMLElement; target: string | null; frame?: number } | null>(null);
    useLayoutEffect(() => { latest.current = options; });
    const controller = useMemo(() => {
        const target = () => {
            const g = gesture.current;
            if (!g || !latest.current.enabled || g.context !== latest.current.context) return null;
            const row = document.elementFromPoint(g.x, g.y)?.closest<HTMLElement>('.segment[data-tag-drop-enabled="true"]');
            const id = row?.id.startsWith('segment-') ? row.id.slice(8) : null;
            return id && id !== g.source && latest.current.canDrop(g.source, id, g.tag) ? id : null;
        };
        const cancel = () => {
            const g = gesture.current; if (!g) return;
            gesture.current = null;
            if (g.frame !== undefined) cancelAnimationFrame(g.frame);
            g.ghost?.remove();
            g.element.style.cursor=g.cursor;
            try { g.element.releasePointerCapture?.(g.pointer); } catch { /* Capture may already be lost. */ }
            if (g.active) suppressed.current = performance.now() + 500;
            latest.current.onTarget(null);
        };
        const update = () => {
            const g = gesture.current; if (!g?.active) return;
            g.ghost!.style.transform = `translate3d(${g.x + 12}px,${g.y + 12}px,0)`;
            const id = target();
            if (id !== g.target) { g.target = id; latest.current.onTarget(id); }
        };
        const tick = () => {
            const g = gesture.current; if (!g?.active) return;
            const scroll = document.elementFromPoint(g.x,g.y)?.closest<HTMLElement>('[data-tag-drop-scroll]');
            if (scroll) {
                const box = scroll.getBoundingClientRect();
                const speed = g.y < box.top + 24 ? -12 : g.y > box.bottom - 24 ? 12 : 0;
                if (speed) scroll.scrollBy(0,speed);
            }
            update(); g.frame = requestAnimationFrame(tick);
        };
        const api: SegmentTagDrag & { cancel: () => void } = {
            cancel, enabled: () => latest.current.enabled, canClick: () => performance.now() >= suppressed.current,
            start: (source,tag,name,event) => {
                if (!latest.current.enabled || event.button !== 0 || !segmentDragModifier(event) || isEditorComposing()
                    || document.querySelector('[role="dialog"],dialog[open]') || !latest.current.canStart(source,tag)) return;
                if ((event.target as Element).closest('.tag-pill-remove,input,textarea,select')) return;
                event.preventDefault(); event.stopPropagation(); cancel();
                gesture.current = {context:latest.current.context,source,tag,name,pointer:event.pointerId,element:event.currentTarget,cursor:event.currentTarget.style.cursor,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,active:false,target:null};
                event.currentTarget.setPointerCapture(event.pointerId);
            },
            move: event => {
                const g = gesture.current; if (!g || event.pointerId !== g.pointer) return;
                event.preventDefault(); event.stopPropagation(); g.x = event.clientX; g.y = event.clientY;
                if (!latest.current.enabled || g.context !== latest.current.context) { cancel(); return; }
                if (!g.active) {
                    if (Math.hypot(g.x-g.startX,g.y-g.startY) < 5) return;
                    g.active = true;
                    g.element.style.cursor='grabbing';
                    g.ghost = document.createElement('span');g.ghost.className='tag-pill tag-drag-ghost';g.ghost.textContent=g.name;g.ghost.setAttribute('aria-hidden','true');document.body.appendChild(g.ghost);
                    g.frame=requestAnimationFrame(tick);
                }
                update();
            },
            finish: (event,commit=true) => {
                const g=gesture.current;if(!g||event.pointerId!==g.pointer)return;
                event.preventDefault();event.stopPropagation();g.x=event.clientX;g.y=event.clientY;
                const id=commit&&g.active?target():null;cancel();
                if(id)void latest.current.onDrop(g.tag,id).catch(latest.current.onError);
            },
        };
        return api;
    }, []);
    useEffect(() => {
        const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')controller.cancel()};
        window.addEventListener('keydown',escape);window.addEventListener('blur',controller.cancel);window.addEventListener('compositionstart',controller.cancel);
        return()=>{window.removeEventListener('keydown',escape);window.removeEventListener('blur',controller.cancel);window.removeEventListener('compositionstart',controller.cancel);controller.cancel()};
    },[controller]);
    useEffect(()=>{controller.cancel()},[options.context,options.enabled,controller]);
    return useMemo(()=>({...controller,enabled:()=>options.enabled}),[controller,options.enabled]);
}
