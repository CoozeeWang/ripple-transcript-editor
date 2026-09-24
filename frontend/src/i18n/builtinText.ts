import sources from './sourceText.json';
import { msg } from './index';
const keys = new Map(Object.entries(sources.builtin).map(([key, text]) => [text, `builtin.${key}`]));
/** Display-only. Never pass this result to an AI request or save it as a user rule. */
export function builtinText(id: string | undefined, text: string): string {
  if (!id?.startsWith('builtin:')) return text;
  return text.split('\n').map(line => keys.has(line) ? msg(keys.get(line)!) : line).join('\n');
}
