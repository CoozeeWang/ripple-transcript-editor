// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import CredentialManager from '../src/CredentialManager';
import { TranscriptionDialog } from '../src/TranscriptionDialog';
import { AnnotationCard } from '../src/components/AnnotationCard';
import { usePlayback } from '../src/hooks/usePlayback';
import { PLAYBACK_RATE_KEY, SKIP_SECONDS_KEY } from '../src/lib/preferences';
import type { CredentialListView, ProviderInfo } from '../src/types';

const noop = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

function provider(id: string): ProviderInfo {
  return { id, name: id, configured: true, models: [],
    capabilities: { diarization: false, language_selection: false, speaker_count_hint: false, audio_events: false, word_timestamps: false },
    credential_fields: [{ key: 'api_key', label: '测试密钥', secret: true, required: true, placeholder: '' }] };
}
function list(p: ProviderInfo): CredentialListView {
  return { provider_id: p.id, provider_name: p.name, experimental: false, fields: p.credential_fields,
    active_profile_id: `${p.id}-profile`,
    profiles: [{ id: `${p.id}-profile`, name: `${p.id} 测试档案`, active: true, field_keys_present: ['api_key'] }] };
}
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

test('credential diagnostics preserve the non-JSON response body', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>synthetic proxy error</html>')));
  render(<CredentialManager />);
  expect(await screen.findByText(/synthetic proxy error/)).toBeTruthy();
});

test('transcription selects a saved configuration without fetching secrets and restores the previous selection', async () => {
  const a = provider('a'), b = provider('b');
  const aList = list(a);
  aList.profiles.push({ id: 'a-second', name: '团队配置', active: false, is_default: true, field_keys_present: ['api_key'] });
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/providers/a/credentials') return json(aList);
    if (url === '/api/providers/b/credentials') return json(list(b));
    if (url.endsWith('/activate')) return json({});
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const onStart = vi.fn(async () => {});
  const props = { providers: [a, b], selectedProviderId: 'a', defaultProviderId: 'a', onSelectProvider: noop,
    hasAudio: true, audioFilename: 'test.wav', busy: false, onClose: noop, onStart };
  const ui = render(<TranscriptionDialog {...props} />);
  await waitFor(() => expect((ui.getByLabelText('转录配置') as HTMLSelectElement).value).toBe('a:a-second'));
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/reveal'))).toBe(false);
  expect(ui.queryByLabelText('测试密钥')).toBeNull();
  fireEvent.click(ui.getByText('开始转录'));
  await waitFor(() => expect(onStart).toHaveBeenCalled());
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/providers/a/credentials/a-profile/activate', { method: 'POST' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/providers/a/credentials/a-second/activate', { method: 'POST' });
  ui.rerender(<TranscriptionDialog {...props} selectedProviderId="b" />);
  expect((ui.getByLabelText('转录配置') as HTMLSelectElement).value).toBe('b:b-profile');
});

test('annotation refresh shows external text when idle and preserves an in-progress draft while editing', () => {
  const annotation = { id: 'a', text: '初始批注', createdAt: new Date().toISOString() };
  const onCommit = vi.fn();
  const ui = render(<AnnotationCard annotation={annotation} onCommit={onCommit} onDelete={noop} />);
  // 空闲态是只读文本（单击跳转、双击编辑），外部更新直接反映出来。
  ui.rerender(<AnnotationCard annotation={{ ...annotation, text: '外部更新' }} onCommit={onCommit} onDelete={noop} />);
  expect(ui.getByText('外部更新')).toBeTruthy();
  // 双击进入编辑后，外部更新不能覆盖正在输入的内容。
  fireEvent.doubleClick(ui.getByText('外部更新'));
  const input = ui.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '正在编辑' } });
  ui.rerender(<AnnotationCard annotation={{ ...annotation, text: '再次更新' }} onCommit={onCommit} onDelete={noop} />);
  expect(input.value).toBe('正在编辑');
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith('正在编辑');
});

test('playback initializes stored preferences and pause clears suspended following', () => {
  localStorage.setItem(PLAYBACK_RATE_KEY, '1.5');
  localStorage.setItem(SKIP_SECONDS_KEY, '5');
  const ui = renderHook(() => usePlayback({ transcript: null, mutateTranscript: noop, activeSegmentId: '',
    setActiveSegmentId: noop, effectiveSelectedSegmentId: '', textareaRefs: { current: new Map() }, setLoadError: noop }));
  expect(ui.result.current.playbackRate).toBe(1.5);
  expect(ui.result.current.defaultPlaybackRate).toBe(1.5);
  expect(ui.result.current.skipSeconds).toBe(5);
  act(() => { ui.result.current.setIsPlaying(true); ui.result.current.setFollowingPaused(true); });
  expect(ui.result.current.followingPaused).toBe(true);
  act(() => ui.result.current.setIsPlaying(false));
  expect(ui.result.current.followingPaused).toBe(false);
  act(() => ui.result.current.setIsPlaying(true));
  expect(ui.result.current.followingPaused).toBe(false);
});
