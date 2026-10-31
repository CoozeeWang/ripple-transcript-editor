import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { msg } from '../i18n';
/** Uses the same action hint lifecycle as all other operation instructions. */
export function GroupNameButton({ isMac, dragging, dragEnabled = true, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    isMac: boolean; dragging: boolean; dragEnabled?: boolean; children: ReactNode;
}) {
    return <button {...props} data-action-tip={msg('tags.drag', { key: isMac ? '⌘' : 'Ctrl' })}
        data-tip-modifier={isMac ? 'Meta' : 'Control'} data-tooltip-disabled={dragging || !dragEnabled || props.disabled ? 'true' : undefined}>{children}</button>;
}
