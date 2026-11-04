import { afterEach, expect, it } from 'vitest';
import { msg, setInterfaceLanguage, type InterfaceLanguage } from '../i18n';
import { TagTreeError } from './tags';
import { isTagOperationCancelled, tagErrorMessage } from './tagErrors';

afterEach(() => setInterfaceLanguage('zh-CN'));
it.each<InterfaceLanguage>(['zh-CN', 'zh-TW', 'en'])('distinguishes invalid collections from invalid input paths in %s', async language => {
 await setInterfaceLanguage(language);
 expect(tagErrorMessage(new TagTreeError('invalid_tree'))).toBe(msg('tags.collectionInvalid'));
 expect(tagErrorMessage(new TagTreeError('invalid_tree'))).not.toBe(tagErrorMessage(new TagTreeError('invalid_path')));
 expect(tagErrorMessage(new TagTreeError('invalid_path'))).toBe(msg('tags.pathInvalid'));
});
it('recognizes a cancelled merge through the inline rename error cause', () => {
 const cancelled = Error('tag_operation_cancelled');
 expect(isTagOperationCancelled(cancelled)).toBe(true);
 expect(isTagOperationCancelled(Error('Translated cancellation', { cause: cancelled }))).toBe(true);
 expect(isTagOperationCancelled(Error('Synthetic disk failure'))).toBe(false);
});

it.each<InterfaceLanguage>(['zh-CN', 'zh-TW', 'en'])('identifies duplicate names through wrapped transaction errors in %s', async language => {
 await setInterfaceLanguage(language);
 const error = new TagTreeError('name_conflict', 'Synthetic tag');
 expect(tagErrorMessage(Error('wrapped', {cause:error}))).toBe(msg('tags.nameConflict', {name:'Synthetic tag'}));
 expect(tagErrorMessage(error)).not.toBe(tagErrorMessage(new TagTreeError('path_conflict', 'Synthetic tag')));
});
