/** Internal metadata ordering must never fall through to external-file import. */
export const PROJECT_ORDER = 'application/x-ripple-order';
export const PROJECT_ORDER_GROUP = 'application/x-ripple-order-group';
export function isProjectOrder(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).includes(PROJECT_ORDER);
}

/** Locate the adjacent row even when the pointer is in its margin or at a list end. */
export function orderTarget(container: HTMLElement, group: string, clientY: number) {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-order-group]'))
    .filter(row => row.dataset.orderGroup === group);
  const row = rows.find(row => clientY < row.getBoundingClientRect().bottom) ?? rows.at(-1);
  if (!row) return null;
  const rect = row.getBoundingClientRect();
  return { id: row.dataset.orderId!, after: clientY > rect.top + rect.height / 2 };
}
