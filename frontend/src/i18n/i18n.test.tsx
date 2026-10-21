// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { interfaceLanguage, LANGUAGE_KEY, msg, setInterfaceLanguage, useInterfaceLanguage } from './index';
import { formatRelativeTime, keys, toDatetimeLocalValue } from '../lib/format';
import zh from './locales/zh-CN.json';
import en from './locales/en.json';
import tw from './locales/zh-TW.json';

afterEach(async () => { cleanup(); await setInterfaceLanguage('zh-CN'); });
describe('interface language', () => {
  it('keeps editable user content and mounted state while switching', async () => {
    const initial = '项目「原始转录稿」 <b>Hello</b> — AI 原文';
    function Editor() {
      const language = useInterfaceLanguage();
      const [text, setText] = useState(initial);
      return <><label>{msg('language.label')}<textarea value={text} onChange={e => setText(e.target.value)} /></label><output>{language}</output></>;
    }
    render(<Editor />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: initial + '修改' } });
    await act(() => setInterfaceLanguage('en'));
    expect(screen.getByLabelText('Interface language')).toBe(textarea);
    expect((textarea as HTMLTextAreaElement).value).toBe(initial + '修改');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('en');
    await act(() => setInterfaceLanguage('zh-CN'));
    expect(screen.getByLabelText('界面语言')).toBe(textarea);
  });
  it('keeps interpolation values verbatim', async () => {
    await setInterfaceLanguage('en');
    const name = '中文项目 <b>{{text}}</b> & English';
    expect(msg('ProjectWorkspace.m0920', { v0: name })).toContain(name);
  });
  it('continues switching when browser preference storage is unavailable', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await setInterfaceLanguage('en');
    expect(interfaceLanguage()).toBe('en');
    spy.mockRestore();
  });
  it('has matching keys and interpolation variables in all three languages', () => {
    const flatten = (value: object): Record<string, string> => Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => typeof entry === 'string' ? [[key, entry]] : Object.entries(flatten(entry)).map(([sub, text]) => [key + '.' + sub, text])));
    const source = flatten(zh);
    for (const catalog of [en, tw]) {
      const target = flatten(catalog);
    expect(Object.keys(target).sort()).toEqual(Object.keys(source).sort());
    for (const [key, text] of Object.entries(source)) {
      expect(target[key].trim(), key).not.toBe('');
      expect([...new Set(target[key].match(/{{\w+}}/g) ?? [])].sort(), key).toEqual([...new Set(text.match(/{{\w+}}/g) ?? [])].sort());
    }
    }
  });
});

it('uses English relative dates and leaves partial recording dates and platform shortcuts intact', async () => {
  await setInterfaceLanguage('en');
  expect(formatRelativeTime(new Date(Date.now() - 60000).toISOString())).toBe('1 minute ago');
  expect(toDatetimeLocalValue('1982')).toBe('1982');
  expect(toDatetimeLocalValue('1982-08')).toBe('1982-08');
  expect(keys('E')).toMatch(/⌘E|Ctrl\+E/);
});

it('refreshes existing app notices while leaving unrecognized technical detail intact', async () => {
  const { uiMessage } = await import('./index');
  const chineseNotice = msg('ProjectWorkspace.m0901');
  await setInterfaceLanguage('en');
  expect(uiMessage(chineseNotice)).toBe(msg('ProjectWorkspace.m0901'));
  expect(uiMessage('unrecognized detail 123')).toBe('unrecognized detail 123');
});

it('uses reviewed full messages and separate singular/plural counts without changing names', async () => {
  await setInterfaceLanguage('en');
  expect(msg('review.sessionCount', { count: 0 })).toBe('0 sessions');
  expect(msg('review.sessionCount', { count: 1 })).toBe('1 session');
  expect(msg('review.sessionCount', { count: 2 })).toBe('2 sessions');
  expect(msg('review.emptyTrash', { count: 1 })).toContain('1 item from');
  expect(msg('review.emptyTrash', { count: 1 })).toContain('restore it.');
  expect(msg('review.emptyTrash', { count: 2 })).toContain('2 items from');
  expect(msg('review.importSummary', {
    originals: msg('review.originalCount', { count: 1 }),
    revisions: msg('review.revisionCount', { count: 2 }),
    details: msg('review.importDetails'),
  })).toContain('1 original · 2 revisions.');
  const name = '我的项目 {{name}} <音频> & AI 原文';
  expect(msg('review.projectFolder', { projectName: name })).toContain(name);
  expect(msg('extra.defaultProfile', { name })).toBe(name + ' (default)');
  await setInterfaceLanguage('zh-CN');
  expect(formatRelativeTime(new Date(Date.now() - 60000).toISOString())).toBe('1 分钟前');
  expect(msg('review.sessionCount', { count: 2 })).toBe('2 个场次');
});

it('keeps source metadata lookup independent of reviewed Chinese display text', async () => {
  const { serviceText } = await import('./serviceText');
  await setInterfaceLanguage('zh-CN');
  expect(serviceText('模型名')).toBe(msg('serviceCatalog.b0219'));
});

it.each([0, 1, 2])('uses the recording quantity %i for selection and move description', async count => {
  await setInterfaceLanguage('en');
  const noun = count === 1 ? 'recording' : 'recordings';
  expect(msg('recordingMove.selected', { count })).toBe(`${count} ${noun} selected`);
  expect(msg('recordingMove.actionSelected', { count })).toBe(`Move ${count} selected ${noun} to another session`);
  await setInterfaceLanguage('zh-CN');
  expect(msg('recordingMove.selected', { count })).toBe(`已选 ${count} 条录音`);
  expect(msg('recordingMove.actionSelected', { count })).toBe(`移动所选 ${count} 条录音到其他场次`);
});

it('switches through all three languages without changing content or persistent names', async () => {
  const { LANGUAGE_OPTIONS, normalizeInterfaceLanguage, uiMessage, isMessage, formatNumber } = await import('./index');
  expect(LANGUAGE_OPTIONS.map(option => option.value)).toEqual(['zh-CN', 'zh-TW', 'en']);
  expect(normalizeInterfaceLanguage('zh-TW')).toBe('zh-TW');
  expect(normalizeInterfaceLanguage('unexpected')).toBe('zh-CN');
  const content = 'Synthetic 專案 原始转录稿 <AI> {{name}}';
  function Draft() { useInterfaceLanguage(); const [text, setText] = useState(content); return <><label>{msg('language.label')}<textarea value={text} onChange={e => setText(e.target.value)}/></label><output>{msg('recordingMove.selected', { count: 1 })}</output></>; }
  render(<Draft/>);
  const field = screen.getByRole('textbox');
  const existing = msg('ProjectWorkspace.m0901');
  for (const language of ['zh-TW', 'en', 'zh-CN'] as const) {
    await act(() => setInterfaceLanguage(language));
    expect(screen.getByRole('textbox')).toBe(field);
    expect((field as HTMLTextAreaElement).value).toBe(content);
    expect(document.documentElement.lang).toBe(language);
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe(language);
    expect(uiMessage(existing)).toBe(msg('ProjectWorkspace.m0901'));
    expect(isMessage(msg('ProjectWorkspace.m0901'), 'ProjectWorkspace.m0901')).toBe(true);
  }
  await act(() => setInterfaceLanguage('zh-TW'));
  expect(screen.getByText('已選取 1 筆錄音')).toBeTruthy();
  expect(formatNumber(12345)).toBe(new Intl.NumberFormat('zh-TW').format(12345));
  expect(toDatetimeLocalValue('2026-10')).toBe('2026-10');
  expect(msg('nativeMenu.undo')).toBe('復原');
});
