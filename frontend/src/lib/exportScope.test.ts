import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { Transcript } from '../types';
import { selectExportScope, buildExportModel, renderTxt, renderMarkdown, renderPdfHtml, renderSubtitles, buildJsonPayload, transcriptBlob } from './export';
const source: Transcript = { audio: { filename: 'synthetic.wav', duration: 3 }, speakers: [{ id: 'a', name: 'Synthetic A' }, { id: 'b', name: 'Synthetic B' }], segments: [{ id: 's1', speaker_id: 'a', text: 'Synthetic hidden', start: 0, end: 1, tagIds: ['tag'] }, { id: 's2', speaker_id: 'b', text: 'Synthetic untagged', start: 1, end: 2 }, { id: 's3', speaker_id: 'b', text: 'Synthetic visible', start: 2, end: 3, tagIds: ['tag'] }] };
describe('export current version scope', () => {
    it('uses the same multi-tag AND/OR selector for full results rather than viewport rows',()=>{
        const multiple={...source,segments:[{...source.segments[0],tagIds:['tag','other']},{...source.segments[1],tagIds:['other']},source.segments[2]]};
        const hidden=new Set(['a']);expect(()=>selectExportScope(multiple,'visible',hidden,{ids:['tag','other'],mode:'and'})).toThrow();
        const union=selectExportScope(multiple,'visible',hidden,{ids:['tag','other'],mode:'or'});expect(union.segments.map(segment=>segment.id)).toEqual(['s2','s3']);expect(union.exportSegmentNumbers).toEqual({s1:1,s2:2,s3:3});
        expect(selectExportScope(multiple,'full',hidden,{ids:['missing'],mode:'and'}).segments).toHaveLength(3);
    });
    it('keeps full text independent of filters and preserves source ordinals', () => { const full = selectExportScope(source, 'full', new Set(['a']), 'tag'); expect(full.segments).toEqual(source.segments); expect(full.exportSegmentNumbers).toEqual({ s1: 1, s2: 2, s3: 3 }); expect(source).not.toHaveProperty('exportSegmentNumbers'); });
    it('exports the complete speaker/tag intersection with original timing and numbers', async () => {
        const selected = selectExportScope(source, 'visible', new Set(['a']), 'tag'), model = buildExportModel(selected, null);
        expect(selected.segments).toEqual([source.segments[2]]);
        for (const text of [renderTxt(model), renderMarkdown(model), renderPdfHtml(model)]) {
            expect(text).toContain('Synthetic B');expect(text).toContain('(3)');expect(text).not.toContain('3 · Synthetic B');
            expect(text).toContain('Synthetic visible');
            expect(text).not.toContain('Synthetic hidden');
        }
        expect(renderSubtitles(selected, 'srt')).toContain('3\n00:00:02,000 --> 00:00:03,000');
        expect(renderSubtitles(selected, 'vtt')).toContain('3\n00:00:02.000');
        const payload = buildJsonPayload(selected, 'synthetic');
        expect(payload).not.toHaveProperty('exportSegmentNumbers');
        expect(payload.segments).toEqual([expect.objectContaining({ id: 's3', sourceSegmentNumber: 3, start: 2, end: 3 })]);
        expect((payload.segments as Record<string, unknown>[])[0]).not.toHaveProperty('tagIds');
        const blob = await transcriptBlob('docx', selected, null), zip = await JSZip.loadAsync(await blob.arrayBuffer()), xml = await zip.file('word/document.xml')!.async('text');
        expect(xml).toContain('Synthetic B');expect(xml).toContain('[00:00:02] (3)');
        expect(xml).toContain('Synthetic visible');
        expect(xml).not.toContain('Synthetic hidden');
    });
    it('never falls back to full text when the displayed intersection is empty', () => { expect(() => selectExportScope(source, 'visible', new Set(['a', 'b']), null)).toThrow(); expect(() => selectExportScope(source, 'visible', new Set(), 'missing')).toThrow(); });
});
it('exports descendants of a selected parent with speaker intersection while keeping full export independent',async()=>{const {emptyTagLibrary,setTagPath,hierarchyTagFilter}=await import('./tags');const library=setTagPath(emptyTagLibrary(),'Topic/Detail').library,[parent,child]=library.tags;const transcript={...source,segments:source.segments.map((segment,index)=>({...segment,tagIds:index===1?[parent.id]:[child.id]}))};const filter=hierarchyTagFilter(library,[parent.id,child.id],'and');const visible=selectExportScope(transcript,'visible',new Set(['a']),filter);expect(visible.segments.map(s=>s.id)).toEqual(['s3']);expect(visible.exportSegmentNumbers?.s3).toBe(3);expect(selectExportScope(transcript,'full',new Set(['a']),filter).segments).toHaveLength(3);const model=buildExportModel(visible,null);expect(renderTxt(model)).toContain('Synthetic B [00:00:02] (3)');expect(renderSubtitles(visible,'srt')).toContain('3\n00:00:02');const json=buildJsonPayload(visible,'synthetic');expect(json.segments).toHaveLength(1)});

it('numbers unfiltered human exports after timestamps and excludes internal collection metadata from JSON',()=>{
 const value={...source,tagCollection:{schemaVersion:1 as const,tagIds:['tag'],groups:[{id:'g',name:'Synthetic group',tagIds:['tag']}]}};
 const model=buildExportModel(value,null);expect(renderTxt(model)).toContain('Synthetic B [00:00:02] (3)');expect(renderTxt(model)).not.toContain('3 · Synthetic B');
 expect(buildJsonPayload(value,'synthetic')).not.toHaveProperty('tagCollection');
});
