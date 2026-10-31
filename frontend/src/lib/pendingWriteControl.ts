/** Keep an otherwise available control visually stable during a short durable write.
 * Native disabled still prevents clicks/keyboard. Real read-only/unavailable states retain their styling. */
export function pendingWriteControl(disabled?: boolean, pending?: boolean) {
    return {disabled: !!disabled || !!pending, 'data-write-pending': !!pending && !disabled || undefined};
}
