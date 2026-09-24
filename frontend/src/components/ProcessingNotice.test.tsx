// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ProcessingNotice } from './ProcessingNotice';

afterEach(cleanup);
it('keeps progress outside the workspace layout and removes it when finished', () => {
  const { container, rerender } = render(<main><ProcessingNotice>正在处理，请稍候…</ProcessingNotice><section>项目内容</section></main>);
  expect(screen.getByRole('status').parentElement).toBe(document.body);
  expect(container.querySelector('main')?.children.length).toBe(1);
  rerender(<main><section>项目内容</section></main>);
  expect(screen.queryByRole('status')).toBeNull();
});
