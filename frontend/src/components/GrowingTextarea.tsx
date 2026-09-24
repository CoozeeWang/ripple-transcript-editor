import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export function GrowingTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const resize = () => {
      if (!node.clientWidth) return;
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
    };
    resize();
    let width = node.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (width !== node.clientWidth) { width = node.clientWidth; resize(); }
    });
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref} rows={1} style={{...props.style, overflow:"hidden", resize:"none", maxHeight:"none"}} />;
}
