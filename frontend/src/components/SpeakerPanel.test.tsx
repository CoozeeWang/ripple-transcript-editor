// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { SpeakerPanel } from './SpeakerPanel';
import { speakerColorStyle, speakerAccent } from '../lib/speakers';
import { speakerColorFor } from '../lib/export';
import type { Transcript } from '../types';
afterEach(cleanup);
const initial: Transcript = { audio: { filename: 'a.wav', duration: 2 }, speakers: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }], segments: [] };
function Panel({ readonly = false }: { readonly?: boolean }) {
  const [transcript, update] = useState(initial);
  return <><SpeakerPanel speakers={transcript.speakers} hiddenSpeakerIds={new Set()} viewingOriginal={readonly}
    mergeMenuFor={null} setMergeMenuFor={vi.fn()} mergeMenuRef={{ current: null }} collapsed={false} setCollapsed={vi.fn()}
    mutateTranscript={update} toggleHideSpeaker={vi.fn()} setMergePrompt={vi.fn()} deleteSpeaker={vi.fn()} addSpeaker={vi.fn()}
    hasEnglishSpeakerTemplate={false} normalizeEnglishSpeakerTemplates={vi.fn()} />
    <output>{JSON.stringify(transcript)}</output></>;
}
test('changing color updates only that speaker and the shared display and export color', () => {
  const ui = render(<Panel />);
  fireEvent.click(ui.getByRole('button', { name: '修改 甲 的颜色' }));
  expect(ui.getByRole('group', {name:'系统预设'}).querySelectorAll('button')).toHaveLength(10);
  fireEvent.click(ui.getByRole('button', {name:'灰紫'}));
  const saved = JSON.parse(ui.getByRole('status').textContent!);
  expect(saved.speakers).toEqual([{ id: 'a', name: '甲', color: '#9272A5', colorIndex: 4 }, initial.speakers[1]]);
  expect(ui.getByLabelText('重命名 甲').closest('.speaker-card')?.getAttribute('style')).toContain('--speaker-accent: #9272A5');
  expect(speakerColorFor('a', saved.speakers)).toBe('#9272A5');
  expect(speakerColorStyle(saved.speakers[0])).toMatchObject({ '--speaker-accent': '#9272A5', '--speaker-bg': '#9272A50d' });
});
test('originals are read-only and malformed imported colors fall back to the palette', () => {
  const ui = render(<Panel readonly />);
  expect(ui.queryByLabelText('修改 甲 的片段颜色')).toBeNull();
  const speaker = { id: 'a', name: '甲', color: 'red;bad', colorIndex: 1 };
  expect(speakerAccent(speaker)).toBe('#B56555');
  expect(speakerColorStyle(speaker)).toMatchObject({"--speaker-accent":"#B56555"});
});
