// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';

afterEach(() => vi.restoreAllMocks());

test.each(['prefs','ai'] as const)('%s settings contains no desktop update entry', tab => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() });
  const ref = { current: null };
  render(<SettingsModal
    settingsTab={tab}
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

  expect(screen.queryByRole('button',{name:'检查更新'})).toBeNull();
  expect(screen.queryByText('软件更新')).toBeNull();
  expect(document.querySelector('#settings-tab-plans')).toBeNull();
  expect(screen.queryByText('Ripple 内置编辑')).toBeNull();
});
