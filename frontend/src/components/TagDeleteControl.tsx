import { msg } from '../i18n';
import { ActionIcon } from './ActionIcon';
/** Branch removal in the selected scope, always confirmed by the caller. */
export function TagDeleteControl({ name, count, disabled, onDelete, scope = 'project' }: {
    name: string; count: number; disabled: boolean; scope?: 'current' | 'project'; onDelete: () => void;
}) {
    return <span className="tag-delete-control" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <button type="button" className="library-delete" disabled={disabled} aria-label={`${msg(scope === 'current' ? 'tags.removeCurrent' : 'tags.deleteTag')}: ${name}`} aria-haspopup="dialog"
            data-action-tip={msg(scope === 'current' ? 'tags.removeCurrentHint' : 'tags.deleteProjectHint', { count })}
            onKeyDown={event => { if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); }}
            onClick={event => { if (event.detail < 2) onDelete(); }}><ActionIcon kind="trash"/></button>
    </span>;
}
