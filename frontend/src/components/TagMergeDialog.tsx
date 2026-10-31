import { useId } from 'react';
import { msg } from '../i18n';
import type { TagMergeRequired } from '../lib/tagCollections';
import { TagModal } from './TagModal';

/** A shared identity collision is never resolved implicitly by a text editor or a drag. */
export function TagMergeDialog({ request, onChoose }: { request: TagMergeRequired; onChoose: (accepted: boolean) => void }) {
    const description = useId();
    return <TagModal compact title={msg('tags.mergeTitle')} descriptionId={description} onClose={() => onChoose(false)}>
        <p className="trash-material-name">{request.path}</p>
        <p id={description} className="settings-hint">{msg('tags.mergeNotice', { count: request.affected })}</p>
        <div className="project-actions audio-project-footer">
            <button type="button" data-cancel className="button button--secondary" onClick={() => onChoose(false)}>{msg('tags.cancel')}</button>
            <button type="button" className="button button--primary" onClick={() => onChoose(true)}>{msg('tags.mergeConfirm')}</button>
        </div>
    </TagModal>;
}
