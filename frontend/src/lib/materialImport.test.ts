// @vitest-environment jsdom
import { File as NodeFile } from 'node:buffer';
import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseManuscript, prepareMaterials } from './materialImport';
const file = (text: string | Uint8Array, name: string) => new NodeFile([typeof text === "string" ? text : new Uint8Array(text)], name) as unknown as File;
it('imports text without inventing timestamps or speakers', async () => {
  const result = await parseManuscript(file('第一段原话\n\n第二段原话', '访谈.txt'));
  expect(result.timeAligned).toBe(false);
  expect(result.segments.map(s => s.text)).toEqual(['第一段原话', '第二段原话']);
  expect(result.segments.every(s => s.start === 0 && s.end === 0)).toBe(true);
});
it('preserves SRT and VTT cue timing and multiline text', async () => {
  for (const name of ['访谈.srt', '访谈.vtt']) {
    const result = await parseManuscript(file('WEBVTT\n\n1\n00:01:02.500 --> 00:01:04.000\n第一行\n第二行\n\n2\n00:01:05.000 --> 00:01:06.000\n后文', name));
    expect(result.timeAligned).toBe(true);
    expect(result.segments[0]).toMatchObject({ start: 62.5, end: 64, text: '第一行\n第二行' });
  }
  await expect(parseManuscript(file('1\n00:02:00,000 --> 00:01:00,000\n错误', 'bad.srt'))).rejects.toThrow('早于');
});
it('reads Word paragraph text including breaks and tables as plain text', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>原话</w:t><w:br/><w:t>换行</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格文字</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
  const result = await parseManuscript(file(await zip.generateAsync({ type: 'uint8array' }), '访谈.docx'));
  expect(result.segments.map(s => s.text)).toEqual(['原话', '换行', '表格文字']);
  expect(result.timeAligned).toBe(false);
});
it('suggests only an unambiguous same-name audio match', async () => {
  const handle = (name: string) => ({ name, getFile: async () => file('已有转录稿', name) }) as FileSystemFileHandle;
  const result = await prepareMaterials([{ handle: handle('甲.wav') }, { handle: handle('甲.txt') }, { handle: handle('乙.txt') }]);
  expect(result[1].audioId).toBe('');
  expect(result[1].suggestedAudioId).toBe(result[0].id);
  expect(result[2].audioId).toBe('');
  await expect(parseManuscript(file('', 'empty.txt'))).rejects.toThrow('没有正文');
});
