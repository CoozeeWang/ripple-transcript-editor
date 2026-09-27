import { afterEach, expect, it } from 'vitest';
import { setInterfaceLanguage } from '../i18n';
import { importedManuscriptName, originalVersionLabel } from './transcriptLabels';
import type { TranscriptModel } from '../types';

afterEach(async()=>{await setInterfaceLanguage('zh-CN');});
const model:TranscriptModel={id:'m1',engine:'imported',sourceKind:'import',sourceName:'河东河西_A_v1.json',original:'旧_导入稿.json',edits:[],activeEditId:''};
it('uses a source filename or custom name for legacy and new imported snapshots',async()=>{
 expect(originalVersionLabel(model)).toBe('河东河西_A_v1（只读）');
 const renamed={...model,label:'人工校订稿'};
 expect(importedManuscriptName(renamed)).toBe('人工校订稿');
 await setInterfaceLanguage('en');
 expect(originalVersionLabel(renamed)).toBe('人工校订稿 (read-only)');
 expect(model.sourceName).toBe('河东河西_A_v1.json');
 expect(model.original).toBe('旧_导入稿.json');
});
it('keeps designated and engine originals identifiable',()=>{
 expect(originalVersionLabel({...model,designatedOriginal:true})).toBe('原始转录稿（只读）');
 expect(originalVersionLabel({...model,sourceKind:'transcription'})).toBe('原始转录稿（只读）');
});
