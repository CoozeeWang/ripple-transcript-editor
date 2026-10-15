import { afterEach, expect, it } from 'vitest';
import { setInterfaceLanguage } from './index';
import { apiErrorMessage } from './errors';
import { serviceText } from './serviceText';
import { buildExportModel, buildJsonPayload, renderMarkdown, renderTxt, renderPdfHtml } from '../lib/export';
import type { Transcript } from '../types';
afterEach(() => setInterfaceLanguage('zh-CN'));
it('localizes coded and legacy errors but keeps service or AI-generated details verbatim', async () => {
  await setInterfaceLanguage('en');
  expect(apiErrorMessage({ message_code: 'ripple_rule_conflict', params: {v0:'模型原始内容：不要翻译'} },409)).toBe('Rules conflict. Adjust them and retry: 模型原始内容：不要翻译');
  expect(apiErrorMessage({detail:'Word 文件为空。'},422)).toBe('The Word file is empty.');
  expect(apiErrorMessage({detail:{message:'third party detail',code:'invalid_api_key'}},401)).toContain('API key');
  expect(apiErrorMessage({detail:'SECRET stack trace'},500)).not.toContain('SECRET');
  expect(serviceText('腾讯云录音文件识别（标准版）')).toBe('Tencent Cloud Audio File Recognition');
});
it('exports translated labels without changing manuscript content or JSON data', async () => {
  const transcript: Transcript = { audio: {filename:'中文音频.wav',duration:1}, speakers:[{id:'s',name:'原始转录稿'}],segments:[{id:'1',speaker_id:'s',start:0,end:1,text:'用户原文 <script> & AI generated',annotations:[{id:'a',text:'中文批注',createdAt:'2026-09-23'}]}] };
  const before = JSON.stringify(transcript);
  const json = buildJsonPayload(transcript, undefined);
  await setInterfaceLanguage('en');
  const model = buildExportModel(transcript,null);
  const { marked } = await import('marked');
  const { JSDOM } = await import('jsdom');
  const markdownDocument = new JSDOM(await marked.parse(renderMarkdown(model))).window.document;
  expect(markdownDocument.body.textContent).toContain('Audio: 中文音频.wav');
  expect(markdownDocument.body.textContent).toContain('用户原文 <script> & AI generated');
  expect(markdownDocument.querySelector('script')).toBeNull();
  expect(renderTxt(model)).toContain('用户原文 <script> & AI generated');
  expect(renderPdfHtml(model)).toContain('<button onclick="window.print()">Print</button>');
  expect(renderPdfHtml(model)).toContain('&lt;script&gt;');
  expect(JSON.stringify(transcript)).toBe(before);
  expect(buildJsonPayload(transcript,undefined)).toEqual(json);
});

it('updates export format labels after switching an already loaded interface', async () => {
  const { exportFormats } = await import('../lib/export');
  await setInterfaceLanguage('zh-CN');
  expect(exportFormats().find(([,format]) => format === 'txt')?.[0]).toContain('纯文本');
  expect(exportFormats().find(([,format]) => format === 'pdf')?.[0]).toBe('PDF');
  await setInterfaceLanguage('en');
  expect(exportFormats().find(([,format]) => format === 'txt')?.[0]).toContain('Plain text');
  expect(exportFormats().find(([,format]) => format === 'pdf')?.[0]).toBe('PDF');
});

it('localizes missing interview and audio errors from current and legacy service responses',async()=>{
 await setInterfaceLanguage('zh-CN');
 expect(apiErrorMessage({message_code:'ripple_interview_missing'},404)).toBe('找不到访谈。请重新打开项目后重试。');
 expect(apiErrorMessage({detail:'Audio not found'},404)).toBe('找不到音频。请重新选择原音频后重试。');
 await setInterfaceLanguage('en');
 expect(apiErrorMessage({message_code:'ripple_audio_missing'},404)).toContain('Select the original audio and try again.');
});
