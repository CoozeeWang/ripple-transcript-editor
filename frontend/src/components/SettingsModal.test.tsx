// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';

afterEach(() => vi.restoreAllMocks());

test('AI settings exposes only the external MCP connection', () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() });
  const ref = { current: null };
  render(<SettingsModal
    settingsTab="ai"
    setSettingsTab={() => {}}
    settingsRef={ref}
    setSettingsOpen={() => {}}
    defaultPlaybackRate={1}
    setDefaultPlaybackRate={() => {}}
    setPlaybackRate={() => {}}
    audioRef={{ current: null }}
    skipSeconds={3}
    setSkipSeconds={() => {}}
  />);

  expect(document.querySelector('#settings-tab-plans')).toBeNull();
  expect(screen.queryByText('Ripple 内置编辑')).toBeNull();
});
