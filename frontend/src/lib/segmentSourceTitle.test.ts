import { afterEach, expect, it } from 'vitest';
import { setInterfaceLanguage } from '../i18n';
import type { TranscriptModel } from '../types';
import { originalVersionLabel } from './transcriptLabels';
import { segmentSourceTitle } from './segmentSourceTitle';
import { segmentTransfer, segmentLink, escapeRtf } from './segmentTransfer';
const model: TranscriptModel={id:'m1',engine:'synthetic',original:'original.json',activeEditId:'e1',edits:[{id:'e1',file:'edit.json',updated_at:''}]};
const target={project:'project-1',recording:'recording-1',model:'m1',version:'e1',segment:'s1',identity:'12345678-1234-4234-8234-123456789abc'};
afterEach(async()=>{await setInterfaceLanguage('zh-CN');});
it.each([['zh-CN','原始转录稿（只读）'],['zh-TW','原始逐字稿（唯讀）'],['en','Original transcript (read-only)']] as const)('uses the current original display label in %s',async (language, expected)=>{
 await setInterfaceLanguage(language);
 expect(segmentSourceTitle('Source',model,'original')).toBe(`Source · ${expected}`);
 expect(segmentSourceTitle('Source',{...model,designatedOriginal:true},'original')).toBe(`Source · ${originalVersionLabel(model)}`);
});
it('uses the actual edit label and avoids duplicate suffixes or invented IDs',()=>{
 expect(segmentSourceTitle('Source',model,'e1')).toBe('Source · 修改稿 v1');
 expect(segmentSourceTitle('Source · 修改稿 v1',model,'e1')).toBe('Source · 修改稿 v1');
 expect(segmentSourceTitle('Source',model,'missing')).toBe('Source');
 expect(segmentSourceTitle('Source')).toBe('Source');
 expect(segmentSourceTitle('',model,'e1')).toBe('修改稿 v1');
});
it('escapes custom version labels and keeps the URL identical after renaming',()=>{
 const custom={...model,edits:[{...model.edits[0],label:'Draft_<&" {v} \\'}]};
 const segment={id:'s1',speaker_id:'s',start:516,end:563,text:'Body\nSecond'};
 const transcript={audio:{filename:'synthetic.wav',duration:563},speakers:[{id:'s',name:'Speaker'}],segments:[segment]};
 const name=segmentSourceTitle('Source',custom,'e1');
 const result=segmentTransfer(transcript,segment,name,target);
 expect(result.html).toContain('Source · Draft_&lt;&amp;&quot; {v} \\, 08:36–09:23, (1)</a>');
 expect(result.rtf).toContain(escapeRtf(name+', 08:36–09:23, (1)'));
 const renamed=segmentTransfer(transcript,segment,segmentSourceTitle('Renamed',{...custom,edits:[{...custom.edits[0],label:'New label'}]},'e1'),target);
 expect(result.plain.split('\n').at(-1)).toBe(segmentLink(target));
 expect(renamed.plain.split('\n').at(-1)).toBe(segmentLink(target));
 expect(result.plain).toContain(name);
 expect(renamed.plain).toContain('Renamed · New label');
});
