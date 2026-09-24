import sources from './sourceText.json';
import { msg } from './index';
const keys = new Map(Object.entries(sources.serviceCatalog).map(([key, text]) => [text, `serviceCatalog.${key}`]));
/** Only use for service-owned metadata. Profile names, models and user input are data. */
export function serviceText(text: string): string { return keys.has(text) ? msg(keys.get(text)!) : text; }
