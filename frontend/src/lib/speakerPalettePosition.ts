/** Keep the portalled palette inside the viewport, independent of sidebar clipping. */
export function placeSpeakerPalette(anchor: Pick<DOMRect,'left'|'right'|'top'|'bottom'>, popup: Pick<DOMRect,'width'|'height'>, viewportWidth:number, viewportHeight:number) {
  const margin=8, gap=6;
  const width=popup.width||148;
  const maxHeight=Math.max(0,Math.min(300,viewportHeight-margin*2));
  const height=Math.min(popup.height,maxHeight);
  const below=viewportHeight-margin-anchor.bottom-gap;
  const above=anchor.top-gap-margin;
  const desired=below>=height||below>=above?anchor.bottom+gap:anchor.top-gap-height;
  return {
    left:Math.max(margin,Math.min(anchor.right-width,viewportWidth-width-margin)),
    top:Math.max(margin,Math.min(desired,viewportHeight-height-margin)),
    maxHeight,
  };
}
