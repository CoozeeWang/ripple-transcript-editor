import { msg } from '../i18n';
import { TagTreeError } from './tags';
export function tagErrorMessage(error:unknown):string {
    if(error instanceof TagTreeError) {
        if(error.code==='path_conflict')return msg('tags.pathConflict',{name:error.value});
        if(error.code==='cycle')return msg('tags.treeCycle');
        return msg('tags.pathInvalid');
    }
    return msg('tags.saveFailed');
}
