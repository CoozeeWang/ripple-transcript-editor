import {expect,it} from 'vitest';
import JSZip from 'jszip';
import {buildExportModel,renderPdfHtml,transcriptBlob,selectExportScope,exportFormats,exportTextRuns} from './export';
import {effectiveExportMarks,exportMarkCapabilities} from './exportOptions';
import type {Transcript} from '../types';
import type {TagLibrary} from './tags';
const library:TagLibrary={schemaVersion:4,groups:[],treeOrder:['parent','child','secret'],tags:[{id:'parent',name:'Synthetic parent',parentId:null,groupIds:[]},{id:'child',name:'子标签 <&> 😀',parentId:'parent',groupIds:[]},{id:'secret',name:'Unrelated secret',parentId:null,groupIds:[]}]};
const transcript:Transcript={audio:{filename:'synthetic.wav',duration:2},speakers:[{id:'s',name:'Synthetic'}],segments:[{id:'seg',speaker_id:'s',start:0,end:2,text:'甲😀乙 <tag>\n第二行',tagIds:['child'],annotations:[{id:'note',text:'Synthetic annotation',createdAt:'2026-01-01'}],highlights:[{id:'h1',start:1,end:4},{id:'h2',start:3,end:8}]}]};
it.each(Array.from({length:8},(_,i)=>i))('renders actual Word/PDF/JSON markings for combination %i',async mask=>{
 const options={tags:!!(mask&1),highlights:!!(mask&2),annotations:!!(mask&4)},settings={options,library};const before=JSON.stringify(transcript);
 const model=buildExportModel(transcript,null,options,library),html=renderPdfHtml(model);
 expect(exportTextRuns(model.segments[0]).map(run=>run.text).join('')).toBe(transcript.segments[0].text);
 expect(html.includes('<mark>')).toBe(options.highlights);expect(html.includes('Synthetic annotation')).toBe(options.annotations);expect(html.includes('Synthetic parent')).toBe(options.tags);expect(html).not.toContain('Unrelated secret');
 const blob=await transcriptBlob('docx',transcript,null,'synthetic',settings),zip=await JSZip.loadAsync(await blob.arrayBuffer());const xml=await zip.file('word/document.xml')!.async('text');
 expect(xml.includes('w:highlight')).toBe(options.highlights);expect(xml.includes('commentRangeStart')).toBe(options.annotations);expect(xml.includes('Synthetic parent')).toBe(options.tags);expect(xml).not.toContain('Unrelated secret');
 const json=JSON.parse(await(await transcriptBlob('json',transcript,null,'synthetic',settings)).text());expect(!!json.segments[0].tagIds).toBe(options.tags);expect(!!json.segments[0].highlights).toBe(options.highlights);expect(!!json.segments[0].annotations).toBe(options.annotations);
 expect(JSON.stringify(transcript)).toBe(before);
});
it.each(['txt','md'] as const)('supports readable tags and annotations independently, with no highlight markup (%s)',async format=>{
 for(let mask=0;mask<4;mask++){
 const options={tags:!!(mask&1),annotations:!!(mask&2),highlights:true};const text=await(await transcriptBlob(format,transcript,null,'synthetic',{options,library})).text();expect(text.includes('Synthetic parent')).toBe(options.tags);expect(text.includes('Synthetic annotation')).toBe(options.annotations);expect(text).not.toContain('<mark>');expect(text).not.toContain('Unrelated secret');
 }
 expect(exportMarkCapabilities(format)).toEqual(['tags','annotations']);expect(effectiveExportMarks(format).highlights).toBe(false);
});
it('merges overlapping highlighters without duplicating or changing Unicode text',()=>{
 const model=buildExportModel(transcript,null,{tags:false,highlights:true,annotations:false});const runs=exportTextRuns(model.segments[0]);expect(runs.filter(r=>r.highlighted)).toHaveLength(1);expect(runs.map(r=>r.text).join('')).toBe('甲😀乙 <tag>\n第二行');expect(renderPdfHtml(model)).toContain('&lt;');
});
it('uses identical rendering semantics for editor full selection and project version selection',async()=>{
 const editor=selectExportScope(transcript,'full',new Set(),null),project=selectExportScope(structuredClone(transcript),'full',new Set(),null);const settings={options:{tags:true,highlights:true,annotations:true},library};
 for(const format of ['json','txt','md'] as const)expect(await(await transcriptBlob(format,editor,null,'synthetic',settings)).text()).toBe(await(await transcriptBlob(format,project,null,'synthetic',settings)).text());
 const a=await JSZip.loadAsync(await(await transcriptBlob('docx',editor,null,'synthetic',settings)).arrayBuffer()),b=await JSZip.loadAsync(await(await transcriptBlob('docx',project,null,'synthetic',settings)).arrayBuffer());expect(await a.file('word/document.xml')!.async('text')).toBe(await b.file('word/document.xml')!.async('text'));
});
it('removes redundant suffixes from labels while keeping stable file format IDs',()=>{
 expect(exportFormats().map(([,format])=>format)).toEqual(['docx','txt','pdf','json','md']);expect(exportFormats().every(([label])=>!/[（(]\.[a-z]+[)）]/i.test(label))).toBe(true);
});
