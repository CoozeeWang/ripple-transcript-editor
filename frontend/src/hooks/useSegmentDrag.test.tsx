// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { segmentDragModifier, useSegmentDrag } from './useSegmentDrag';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('uses Cmd only on Mac and Ctrl only elsewhere',()=>{
 expect(segmentDragModifier({metaKey:true,ctrlKey:false,altKey:false},true)).toBe(true);
 expect(segmentDragModifier({metaKey:false,ctrlKey:true,altKey:false},true)).toBe(false);
 expect(segmentDragModifier({metaKey:false,ctrlKey:true,altKey:false},false)).toBe(true);
 expect(segmentDragModifier({metaKey:true,ctrlKey:false,altKey:false},false)).toBe(false);
});
it('updates only the hovered row for a 1060-segment manuscript',()=>{
 const renders=new Map<number,number>();const handlers=new Map<number,ReturnType<typeof useSegmentDrag>>();
 function Row({id}:{id:number}) {
  const ref=useRef<HTMLElement>(null);const drag=useSegmentDrag(true,ref);handlers.set(id,drag);
  renders.set(id,(renders.get(id)??0)+1);return <article ref={ref} className="segment" data-id={id} draggable={drag.ready}/>;
 }
 const ui=render(<>{Array.from({length:1060},(_,id)=><Row key={id} id={id}/>)}</>);
 const row=ui.container.querySelector('[data-id="1059"]')!;
 fireEvent.pointerMove(row);renders.clear();
 const queries=vi.spyOn(document,'querySelector');
 const began=performance.now();fireEvent.keyDown(window,{ctrlKey:true});
 console.info('synthetic-1060 modifier ms',performance.now()-began,'rerendered rows',renders.size,'queries',queries.mock.calls.length);
 expect(renders.size).toBe(1);expect(renders.get(1059)).toBe(1);expect(queries.mock.calls.length).toBeLessThanOrEqual(2);
 expect((row as HTMLElement).getAttribute('draggable')).toBe('true');
 act(()=>handlers.get(1059)!.start(true));fireEvent.keyUp(window);fireEvent.blur(window);fireEvent.dragEnd(row);
 expect((row as HTMLElement).getAttribute('draggable')).toBe('true');
 act(()=>handlers.get(1059)!.end());expect((row as HTMLElement).getAttribute('draggable')).toBe('false');
 fireEvent.keyDown(window,{ctrlKey:true});fireEvent.compositionStart(window);expect((row as HTMLElement).getAttribute('draggable')).toBe('false');
 const modal=document.createElement('div');modal.setAttribute('role','dialog');document.body.append(modal);
 fireEvent.keyDown(window,{ctrlKey:true});expect((row as HTMLElement).getAttribute('draggable')).toBe('false');modal.remove();
});
