import { msg } from '../i18n';
import { TagTreeError } from './tags';
import { TagCollectionConflict } from './tagCollections';
export function tagErrorMessage(error:unknown):string {
    if(error instanceof Error&&error.message==='tag_storage_migration_required')return msg('tags.storageUpgradeRequired');
    if(error instanceof Error&&error.message.startsWith('tag_metadata_'))return msg('tags.storageInvalid');
    if(error instanceof Error&&error.message==='tag_history_changed')return msg('tags.undoConflict');
    if(error instanceof TagCollectionConflict) return msg('tags.collectionConflict',{version:error.consumer,paths:error.paths.join('、')});
    if(error instanceof Error && error.message==='tag_operation_cancelled') return msg('tags.operationCancelled');
    if(error instanceof TagTreeError) {
        if(error.code==='path_conflict')return msg('tags.pathConflict',{name:error.value});
        if(error.code==='cycle')return msg('tags.treeCycle');
        return msg('tags.pathInvalid');
    }
    return msg('tags.saveFailed');
}
