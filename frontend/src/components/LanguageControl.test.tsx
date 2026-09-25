// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LanguageControl } from './LanguageControl';
import { setInterfaceLanguage } from '../i18n';

afterEach(async () => {
  cleanup();
  await setInterfaceLanguage('zh-CN');
});

it('suppresses the pointer focus ring while keeping keyboard focus identifiable', () => {
  render(<LanguageControl welcome />);
  const select = screen.getByRole('combobox', { name: '界面语言' });
  const control = select.parentElement!;

  fireEvent.pointerDown(select);
  expect(control.dataset.focusSource).toBe('pointer');

  fireEvent.keyDown(select, { key: 'ArrowDown' });
  expect(control.dataset.focusSource).toBeUndefined();

  fireEvent.pointerDown(select);
  fireEvent.blur(select);
  expect(control.dataset.focusSource).toBeUndefined();
});
