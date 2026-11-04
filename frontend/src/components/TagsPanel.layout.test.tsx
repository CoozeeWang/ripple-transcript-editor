// @vitest-environment jsdom
import {useState}from'react';import{afterEach,expect,it,vi}from'vitest';import{cleanup,fireEvent,render,screen}from'@testing-library/react';import{readFileSync}from'node:fs';import{TagsPanel}from'./TagsPanel';import{setInterfaceLanguage}from'../i18n';
afterEach(async()=>{cleanup();vi.unstubAllGlobals();await setInterfaceLanguage('zh-CN')});
for(const language of ['zh-CN','zh-TW','en']as const)it(`keeps one top scope switch and stable shared toolbar controls in ${language}`,async()=>{
 await setInterfaceLanguage(language);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 function Harness(){const[enabled,setEnabled]=useState(false);return <TagsPanel library={{schemaVersion:4,treeOrder:[],tags:[],groups:[]}} currentTagIds={[]} onChange={async()=>{}} readOnly={false} filter={[]} filterMode="and" onFilterModeChange={()=>{}} filterEnabled={enabled} onFilterEnabledChange={setEnabled} onFilter={()=>{}} currentCount={()=>0}/>}
 const ui=render(<Harness/>),title=ui.container.querySelector('.tag-view-toolbar')!,filter=ui.container.querySelector<HTMLButtonElement>('.tag-filter-toggle')!,mode=ui.container.querySelector('.tag-filter-mode')!,search=ui.container.querySelector('.tag-library-input input'),head=ui.container.querySelector('.tag-list-head');
 expect(title.querySelectorAll('[data-tag-scope]')).toHaveLength(2);expect(ui.container.querySelector('.tag-scope-slot,.tag-scope,[data-tag-view],.tag-group')).toBeNull();expect(ui.container.querySelector('[data-tag-input-mode="group"]')).toBeNull();
 expect(mode.hasAttribute('inert')).toBe(true);expect(screen.queryByRole('group',{name:mode.getAttribute('aria-label')!})).toBeNull();fireEvent.click(filter);expect(mode.hasAttribute('inert')).toBe(false);fireEvent.click(title.querySelector('[data-tag-scope="project"]')!);expect(ui.container.querySelector('.tag-library-input input')).toBe(search);expect(ui.container.querySelector('.tag-list-head')).toBe(head);expect(ui.container.querySelector('.tag-filter-mode')).toBe(mode);fireEvent.click(filter);expect(mode.hasAttribute('inert')).toBe(true);
});
it('reserves hidden AND/OR geometry and shifts only the count boxes by the spacing token',()=>{
 const css=readFileSync('src/components/tags.css','utf8');expect(css).toMatch(/\.tag-toolbar-placeholder\{visibility:hidden;pointer-events:none\}/);expect(css).toContain('--tag-count-offset:var(--space-3)');expect(css).toContain('.tag-count,.tag-count-heading{transform:translateX(var(--tag-count-offset))}');
});
