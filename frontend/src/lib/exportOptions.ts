import type {ExportFormat} from './export';
export interface ExportMarkOptions {tags:boolean;highlights:boolean;annotations:boolean}
export const DEFAULT_EXPORT_MARK_OPTIONS:ExportMarkOptions={tags:true,highlights:true,annotations:true};
const capabilities:Record<ExportFormat,readonly(keyof ExportMarkOptions)[]>={docx:['tags','highlights','annotations'],pdf:['tags','highlights','annotations'],json:['tags','highlights','annotations'],md:['tags','annotations'],txt:['tags','annotations']};
export const exportMarkCapabilities=(format:ExportFormat)=>capabilities[format];
export function effectiveExportMarks(format:ExportFormat,options:ExportMarkOptions=DEFAULT_EXPORT_MARK_OPTIONS):ExportMarkOptions{
 const supported=capabilities[format];return{tags:supported.includes('tags')&&options.tags,highlights:supported.includes('highlights')&&options.highlights,annotations:supported.includes('annotations')&&options.annotations};
}
