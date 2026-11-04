export const ACTION_HINT_EVENT = 'ripple-action-hint';
export interface ActionHintRequest { target: HTMLElement; text: string; tone?: 'restriction' }
/** Explicit blocked-operation feedback shares the existing tooltip lifecycle and style. */
export function showActionHint(target: HTMLElement, text: string, tone?: 'restriction'): void {
    document.dispatchEvent(new CustomEvent<ActionHintRequest>(ACTION_HINT_EVENT, { detail: { target, text, tone } }));
}
