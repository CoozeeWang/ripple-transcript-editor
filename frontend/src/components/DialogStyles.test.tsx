// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DeleteDialog, NamingModal, MatchDialog } from './Dialogs';
import { setInterfaceLanguage } from '../i18n';
import { readFileSync, readdirSync } from 'node:fs';
const css = readFileSync('src/styles.css', 'utf8') + '\n' + readFileSync('src/components/updateWindow.css', 'utf8');
import type { DeletePrompt } from '../hooks/useVersions';

afterEach(async () => { cleanup(); document.querySelectorAll('[data-style-contract]').forEach(node => node.remove()); await setInterfaceLanguage('zh-CN'); });

// Exercise production action rules, including legacy modal selectors. Resolve tokens and
// expose pseudo states as classes because jsdom does not emulate pointer hover.
// This verifies color/focus contracts, not native pixels or layout.
function installStyles() {
  const tokens = new Map([...css.matchAll(/(--[\w-]+):\s*([^;{}]+);/g)].map(match => [match[1], match[2]]));
  const resolve = (value: string): string => value.replace(/var\((--[\w-]+)(?:,[^)]*)?\)/g, (_, key: string) => resolve(tokens.get(key) ?? 'transparent'));
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => /(?:\.button|\.modal-actions|\.delete-modal|\.naming-modal|\.cred-btn|^\s*button:disabled|^\s*:focus-visible)/.test(match[1]));
  const style = document.createElement('style'); style.dataset.styleContract = '';
  style.textContent = rules.map(match => resolve(match[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/:hover/g, '.test-hover').replace(/:focus-visible/g, '.test-keyboard-focus').replace(/:focus\b/g, '.test-focus')) + '{' + resolve(match[2]) + '}').join('\n');
  document.head.append(style);
}
function expectDanger(button: HTMLElement) {
  expect(button.classList.contains('button--danger')).toBe(true);
  expect(getComputedStyle(button).color).toBe('rgb(180, 35, 42)');
  expect(getComputedStyle(button).backgroundColor).toBe('rgb(253, 243, 243)');
  button.classList.add('test-hover');
  expect(getComputedStyle(button).backgroundColor).toBe('rgb(251, 233, 233)');
}

for (const language of ['zh-CN', 'zh-TW', 'en'] as const) {
  for (const kind of ['original', 'edit'] as const) for (const isLast of [false, true]) {
    it(`keeps ${language} ${kind} last=${isLast} deletion dangerous and Cancel initially focused`, async () => {
      await setInterfaceLanguage(language); installStyles();
      const prompt = { kind, modelId: 'synthetic-model', editId: 'synthetic-edit', label: 'Synthetic version', isLast } as DeletePrompt;
      const confirm = vi.fn();
      render(<DeleteDialog prompt={prompt} dialogRef={createRef()} setPrompt={vi.fn()} confirmDelete={confirm}/>);
      const [remove, cancel] = screen.getAllByRole('button');
      expectDanger(remove); expect(document.activeElement).toBe(cancel);
      expect(getComputedStyle(cancel).backgroundColor).toBe('rgb(255, 255, 255)');
      expect(confirm).not.toHaveBeenCalled();
    });
  }
}

it('uses explicit primary/secondary actions and one input focus border for naming, including errors and busy state', () => {
  installStyles();
  render(<NamingModal value="Synthetic version" error="Synthetic error" setError={vi.fn()} busy repairs={[]} setRepairs={vi.fn()} modalRef={createRef()} setOpen={vi.fn()} confirmNaming={vi.fn()}/>);
  const input = screen.getByRole('textbox'); input.classList.add('test-focus', 'test-keyboard-focus');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  expect(getComputedStyle(input).borderColor).toBe('rgb(50, 120, 132)');
  expect(getComputedStyle(input).outline).toBe('none');
  const primary = screen.getByRole('button', { name: '保存中…' });
  expect(primary.hasAttribute('disabled')).toBe(true); primary.classList.add('test-hover');
  expect(getComputedStyle(primary).backgroundColor).toBe('rgb(32, 85, 96)');
});

it('gives shared primary and danger buttons disabled-safe hover and visible keyboard focus independently of position', () => {
  installStyles();
  for (const variant of ['primary', 'danger']) {
    const button = document.createElement('button'); button.className = `button button--${variant} test-keyboard-focus`; document.body.append(button); button.dataset.styleContract = '';
    expect(getComputedStyle(button).outline).toContain('1px');
    button.classList.add('test-hover');
    expect(getComputedStyle(button).backgroundColor).toBe(variant === 'primary' ? 'rgb(24, 67, 76)' : 'rgb(251, 233, 233)');
    button.disabled = true;
    expect(getComputedStyle(button).backgroundColor).toBe(variant === 'primary' ? 'rgb(32, 85, 96)' : 'rgb(253, 243, 243)');
  }
  expect(css).not.toMatch(/\.modal-actions\s+button:first-child/);
  expect(css).not.toContain('.cred-btn--default');
});

it('uses explicit primary matching actions for both ordinary and warning confirmation', () => {
  installStyles();
  const props = {prompt:{sourceName:'Synthetic.json',target:'',candidates:['Synthetic.wav'],choice:'Synthetic.wav',warning:null as string|null,checking:false,transcript:{audio:{filename:'',duration:0},speakers:[],segments:[]}},dialogRef:createRef<HTMLDivElement>(),setPrompt:vi.fn(),finishImport:vi.fn(),confirmMatch:vi.fn()};
  const ui = render(<MatchDialog {...props}/>);
  for (const warning of [null, 'Synthetic mismatch']) {
    ui.rerender(<MatchDialog {...props} prompt={{...props.prompt,warning}}/>);
    const primary = document.querySelector<HTMLElement>('.modal-actions .button--primary')!;
    expect(getComputedStyle(primary).backgroundColor).toBe('rgb(32, 85, 96)');
    primary.classList.add('test-hover'); expect(getComputedStyle(primary).backgroundColor).toBe('rgb(24, 67, 76)');
    primary.classList.remove('test-hover');
  }
});

it('shares primary hover and disabled colors with settings and the separate update window', () => {
  installStyles();
  const host = document.createElement('div'); host.className = 'desktop-update-window'; host.dataset.styleContract = ''; document.body.append(host);
  const button = document.createElement('button'); button.className = 'cred-btn cred-btn--primary'; host.append(button);
  expect(getComputedStyle(button).backgroundColor).toBe('rgb(32, 85, 96)');
  button.classList.add('test-hover'); expect(getComputedStyle(button).backgroundColor).toBe('rgb(24, 67, 76)');
  button.disabled = true; expect(getComputedStyle(button).backgroundColor).toBe('rgb(32, 85, 96)');
});

it('does not reference retired or undefined color tokens without a fallback', () => {
  const styles = readdirSync('src', { recursive: true }).filter(name => typeof name === 'string' && name.endsWith('.css')).map(name => readFileSync(`src/${name}`, 'utf8')).join('\n');
  const defined = new Set([...styles.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  const missing = [...styles.matchAll(/var\((--color-[\w-]+)\s*\)/g)].map(match => match[1]).filter(token => !defined.has(token));
  expect([...new Set(missing)]).toEqual([]);
});
