import {useState} from 'react';
import type {ExportFormat} from '../lib/export';
import {DEFAULT_EXPORT_MARK_OPTIONS,type ExportMarkOptions} from '../lib/exportOptions';
/** Session-local choices per format; shared by editor and project export controls. */
export function useExportMarks(){
 const [choices,setChoices]=useState<Partial<Record<ExportFormat,ExportMarkOptions>>>({});
 return{get:(format:ExportFormat)=>choices[format]??DEFAULT_EXPORT_MARK_OPTIONS,set:(format:ExportFormat,options:ExportMarkOptions)=>setChoices(current=>({...current,[format]:{...options}}))};
}
