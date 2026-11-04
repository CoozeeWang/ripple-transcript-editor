import { useLayoutEffect } from "react";
import { readingViewport } from '../lib/readingViewport';

/** Keep the visible paragraph, not the selected/playback segment, when wrapping
 * changes. Snapshot before resize; ResizeObserver itself runs after layout. */
export function useResizeReadingPosition(panelRef: {current:HTMLElement|null}, context:unknown, ready:boolean, viewIntent?:{current:number}) {
  useLayoutEffect(()=>{
    const panel=panelRef.current;
    if(!panel || !ready || typeof ResizeObserver==="undefined")return;
    let width=panel.getBoundingClientRect().width;
    let anchor:{node:HTMLElement;offset:number;fraction:number}|null=null;
    let anchorIntent=viewIntent?.current;
    const previousAnchoring=panel.style.overflowAnchor;
    panel.style.overflowAnchor="none";
    const tracker=readingViewport(panel);
    const unsubscribe=tracker.subscribe(sample=>{
      // Reflow can dispatch scroll before ResizeObserver restores the old paragraph.
      if(sample.bounds.width!==width)return;
      const position=sample.viewport;
      anchorIntent=viewIntent?.current;
      anchor=position?{node:position.node,offset:position.offset,fraction:position.fraction}:null;
    });
    const resize=new ResizeObserver(()=>{
      const next=panel.getBoundingClientRect().width;
      if(next===width)return;
      width=next;
      if(anchor && anchorIntent===viewIntent?.current && panel.contains(anchor.node)){
        const rect=anchor.node.getBoundingClientRect(),bounds=panel.getBoundingClientRect();
        panel.scrollTo({top:Math.max(0,panel.scrollTop+rect.top-bounds.top+anchor.fraction*rect.height-anchor.offset),behavior:"instant"});
      }
      tracker.capture();
    });
    resize.observe(panel);
    return()=>{
      resize.disconnect();unsubscribe();panel.style.overflowAnchor=previousAnchoring;
    };
  },[panelRef,context,ready,viewIntent]);
}
