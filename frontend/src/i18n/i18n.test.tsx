// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { interfaceLanguage, LANGUAGE_KEY, msg, setInterfaceLanguage, useInterfaceLanguage } from './index';
import { EDITING_PRESETS, presetInstructions } from '../lib/editingPresets';
import { builtinText } from './builtinText';
import { formatRelativeTime, keys, toDatetimeLocalValue } from '../lib/format';
import zh from './locales/zh-CN.json';
import en from './locales/en.json';

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
  it('has matching keys and interpolation variables in both languages', () => {
    const flatten = (value: object): Record<string, string> => Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => typeof entry === 'string' ? [[key, entry]] : Object.entries(flatten(entry)).map(([sub, text]) => [key + '.' + sub, text])));
    const source = flatten(zh), target = flatten(en);
    expect(Object.keys(target).sort()).toEqual(Object.keys(source).sort());
    for (const [key, text] of Object.entries(source)) {
      expect(target[key].trim(), key).not.toBe('');
      expect([...new Set(target[key].match(/{{\w+}}/g) ?? [])].sort(), key).toEqual([...new Set(text.match(/{{\w+}}/g) ?? [])].sort());
    }
  });
});

it('localizes built-in explanations without changing AI instructions or user rules', async () => {
  const plan = EDITING_PRESETS[0];
  const instructions = presetInstructions(plan);
  await setInterfaceLanguage('en');
  expect(builtinText('builtin:faithful', plan.name)).toBe('Faithful transcript');
  expect(presetInstructions(plan)).toBe(instructions);
  expect(builtinText('user-plan', plan.name)).toBe(plan.name);
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
  const { apiErrorMessage } = await import('./errors');
  await setInterfaceLanguage('zh-CN');
  expect(serviceText('模型名')).toBe(msg('serviceCatalog.b0219'));
  expect(apiErrorMessage({detail:'规则最多 30 条，每条 6000 字，合计 12000 字'},422)).toBe(msg('backend.b0014'));
  await setInterfaceLanguage('en');
  expect(apiErrorMessage({detail:'规则最多 30 条，每条 6000 字，合计 12000 字'},422)).toBe(msg('backend.b0014'));
  expect(builtinText('user-plan','忠实转写')).toBe('忠实转写');
});
