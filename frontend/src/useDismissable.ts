import { type RefObject, useEffect } from "react";

/**
 * 统一的浮层关闭契约：Esc 键关闭 + 在浮层外部按下指针时关闭。
 *
 * 用 `pointerdown` 而非 `mousedown`：当用户在浮层内按下鼠标、拖到浮层外再松开时，
 * 不会因为 backdrop 上触发 `mouseup` 而误关。
 *
 * 注意：本 hook 不锁 body 滚动、不管理焦点陷阱；那些由调用方或专门组件处理。
 */
export function useDismissable(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onClose: () => void,
  dismissOnPointerOutside = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      // pointerdown 发生在浮层外部时才关闭；浮层自身及其内部后代不算外部。
      if (ref.current && !ref.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    if (dismissOnPointerOutside) document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [enabled, onClose, ref, dismissOnPointerOutside]);
}
