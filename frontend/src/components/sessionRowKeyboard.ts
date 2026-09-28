import type { KeyboardEvent, MouseEvent } from 'react';

export function adjacentSessionRow(event: KeyboardEvent<HTMLElement>): HTMLElement | null {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  event.preventDefault();
  const rows = Array.from(event.currentTarget.closest('.setup-sidebar')?.querySelectorAll<HTMLElement>('.setup-session-select') ?? []);
  const index = rows.indexOf(event.currentTarget);
  if (index < 0) return null;
  const next = index + (event.key === 'ArrowDown' ? 1 : -1);
  return rows[Math.max(0, Math.min(rows.length - 1, next))] ?? null;
}

export function focusSessionRowFromClick(event: MouseEvent<HTMLElement>): void {
  const target = event.target;
  if (target instanceof Element && target.closest('.inline-edit, .setup-grip, input, textarea, select, button, a')) return;
  event.currentTarget.focus({ preventScroll: true });
}
