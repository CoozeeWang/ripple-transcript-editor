// @vitest-environment jsdom
import {cleanup,render} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const rootCss=readFileSync('src/styles.css','utf8'),tagCss=readFileSync('src/components/tags.css','utf8'),tipCss=readFileSync('src/components/tooltips.css','utf8');
afterEach(()=>{cleanup();document.querySelectorAll('[data-feedback-style]').forEach(e=>e.remove())});
// Exercise production selectors and cascade; expose pointer/keyboard pseudo states as
// classes because jsdom does not implement native hover. This is not pixel acceptance.
function styles(){const tokens=new Map([...(rootCss+tipCss).matchAll(/(--[\w-]+):\s*([^;{}]+);/g)].map(m=>[m[1],m[2]]));const resolve=(value:string):string=>value.replace(/var\((--[\w-]+)(?:,[^)]*)?\)/g,(_,key:string)=>resolve(tokens.get(key)??'transparent'));
 const rules=[...(tagCss+'\n'+tipCss).replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>/library-tag-row|library-pill|library-filter|tag-tree-entry|tag-input-modes|tag-drop-line|ripple-tooltip/.test(m[1]));const style=document.createElement('style');style.dataset.feedbackStyle='';style.textContent=rules.map(m=>resolve(m[1].replace(/:hover/g,'.test-hover').replace(/:focus-visible/g,'.test-focus'))+'{'+resolve(m[2])+'}').join('\n');document.head.append(style)}
function fixture(){styles();const view=render(<div className="tag-library"><div className="tag-tree-entry"><div className="library-tag-row"><span className="library-pill tag-pill"><button className="library-filter">Tag</button></span><span className="tag-count">12</span><button className="library-delete">Delete</button></div><div className="tag-drop-line"/></div><div className="tag-input-modes"><button aria-pressed="true">Create</button><button aria-pressed="false">Search</button></div></div>);return{...view,host:view.container.firstElementChild!,entry:view.container.querySelector('.tag-tree-entry')!,row:view.container.querySelector<HTMLElement>('.library-tag-row')!,pill:view.container.querySelector('.library-pill')!}}
it('uses whole-row neutral hover and temporary accent location without changing pill filter selection or keyboard focus',()=>{
 const h=fixture();h.row.classList.add('test-hover');expect(getComputedStyle(h.row).backgroundColor).toBe('rgb(244, 241, 234)');h.row.dataset.createdLocation='true';expect(getComputedStyle(h.row).backgroundColor).toBe('rgb(229, 239, 240)');h.pill.classList.add('is-filtered');h.entry.classList.add('is-inherited-region');expect(getComputedStyle(h.row).backgroundColor).toBe('rgba(0, 0, 0, 0)');expect(getComputedStyle(h.pill).backgroundColor).toBe('rgb(180, 35, 42)');h.row.querySelector('button')!.classList.add('test-focus');expect(getComputedStyle(h.pill).outline).toContain('1px solid');
});
it('gives active drag feedback priority over hover or location and preserves the insertion line',()=>{
 const h=fixture();h.row.classList.add('test-hover');h.row.dataset.createdLocation='true';h.host.setAttribute('data-tag-drag','move');expect(getComputedStyle(h.row).backgroundColor).toBe('rgba(0, 0, 0, 0)');expect(getComputedStyle(h.container.querySelector('.tag-drop-line')!).backgroundColor).toBe('rgb(32, 85, 96)');
});
it('retains current mode tint on hover while giving other modes neutral hover',()=>{
 const h=fixture();const buttons=[...h.container.querySelectorAll('.tag-input-modes button')];buttons.forEach(e=>e.classList.add('test-hover'));expect(getComputedStyle(buttons[0]).backgroundColor).toBe('rgb(229, 239, 240)');expect(getComputedStyle(buttons[1]).backgroundColor).toBe('rgb(244, 241, 234)');
});
it('uses amber only for restriction hints; ordinary action hints keep their warm surface',()=>{
 styles();const h=render(<><div className="ripple-tooltip ripple-tooltip--action">Ordinary</div><div className="ripple-tooltip ripple-tooltip--action ripple-tooltip--restriction">Restricted</div></>);const[a,b]=[...h.container.children];expect(getComputedStyle(a).backgroundColor).toBe('rgb(255, 253, 248)');expect(getComputedStyle(b).backgroundColor).toBe('rgb(255, 244, 220)');expect(getComputedStyle(b).borderColor).toBe('rgb(221, 194, 138)');expect(getComputedStyle(b).color).toBe('rgb(89, 67, 28)');
});
