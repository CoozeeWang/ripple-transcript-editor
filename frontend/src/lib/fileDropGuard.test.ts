// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installFileDropGuard } from './fileDropGuard';
let cleanup = () => {};
afterEach(() => { cleanup(); document.body.innerHTML = ''; });
function event(type: string, types: string[], items: {kind: string}[] = []) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types, items } });
  return event;
}
describe('external file navigation protection', () => {
  it('covers arbitrary pages, sidebars, inputs and disabled targets without importing', () => {
    cleanup = installFileDropGuard();
    document.body.innerHTML = '<main><aside></aside><input><button disabled></button></main>';
    for (const target of document.body.querySelectorAll('*')) {
      for (const type of ['dragover', 'drop']) {
        const e = event(type, ['Files']); target.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
      }
    }
  });
  it('preserves valid target handling even when it stops propagation', () => {
    cleanup = installFileDropGuard();
    const zone = document.createElement('div'); document.body.append(zone);
    let imported = false;
    zone.addEventListener('drop', e => { expect(e.defaultPrevented).toBe(true); imported = true; e.stopPropagation(); });
    zone.dispatchEvent(event('drop', ['Files'])); expect(imported).toBe(true);
  });
  it('leaves internal sorting and text drags unchanged, and removes handlers', () => {
    cleanup = installFileDropGuard();
    for (const types of [['application/x-ripple-order'], ['text/plain']]) {
      const e = event('drop', types); document.body.dispatchEvent(e); expect(e.defaultPrevented).toBe(false);
    }
    const item = event('drop', [], [{kind:'file'}]); document.body.dispatchEvent(item); expect(item.defaultPrevented).toBe(true);
    cleanup(); const e = event('drop', ['Files']); document.body.dispatchEvent(e); expect(e.defaultPrevented).toBe(false);
  });
});
