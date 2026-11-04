// @vitest-environment jsdom
import{act,cleanup,fireEvent,render,screen}from'@testing-library/react';
import{afterEach,beforeEach,expect,it,vi}from'vitest';
import{TagsPanel}from'./TagsPanel';import{TooltipHost}from'./TooltipHost';import{msg,setInterfaceLanguage}from'../i18n';
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})});
afterEach(async()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();await setInterfaceLanguage('zh-CN')});
it.each(['zh-CN','zh-TW','en']as const)('describes the specific blocked sidebar action in %s without suggesting segment edits are blocked',async language=>{
 await setInterfaceLanguage(language);const rename=vi.fn();render(<><TooltipHost/><TagsPanel library={{schemaVersion:4,treeOrder:['tag'],groups:[],tags:[{id:'tag',name:'Synthetic',parentId:null,groupIds:[]}]}} currentTagIds={['tag']} currentCount={()=>1} filter={[]} filterEnabled filterMode="and" onFilter={()=>{}} onFilterModeChange={()=>{}} onFilterEnabledChange={()=>{}} readOnly={false} onRenameTag={rename} onSortName={async()=>{}} onChange={async()=>{}}/></>);
 fireEvent.doubleClick(screen.getByRole('button',{name:msg('tags.title')+': Synthetic'}));expect(screen.getByRole('tooltip').textContent).toBe(msg('tags.filterEditNotice'));expect(screen.getByRole('tooltip').className).toContain('ripple-tooltip--restriction');expect(rename).not.toHaveBeenCalled();
 const sort=screen.getByRole('button',{name:msg('tags.sortName')});expect((sort as HTMLButtonElement).disabled).toBe(true);fireEvent.pointerOver(sort.parentElement!);act(()=>vi.advanceTimersByTime(800));expect(screen.getByRole('tooltip').textContent).toBe(msg('tags.filterSortNotice'));expect(screen.getByRole('tooltip').className).toContain('ripple-tooltip--restriction');
});
it.each(['zh-CN','zh-TW','en']as const)('explains shared tag structure protection for double click, shortcuts and drag without blocking reading (%s)',async language=>{
 await setInterfaceLanguage(language);const rename=vi.fn(),sort=vi.fn(),reorder=vi.fn(),filter=vi.fn(),hint=msg('tags.sharedAiRestrictionActiveOther');
 render(<><TooltipHost/><TagsPanel sharedStructureHint={hint} library={{schemaVersion:4,treeOrder:['tag'],groups:[],tags:[{id:'tag',name:'Synthetic',parentId:null,groupIds:[]}]}} currentTagIds={['tag']} currentCount={()=>1} filter={[]} filterMode="and" filterEnabled={false} onFilterModeChange={()=>{}} onFilterEnabledChange={()=>{}} onFilter={filter} readOnly={false} onRenameTag={rename} onSortName={sort} onReorder={reorder} onChange={async()=>{}}/></>);
 const tag=screen.getByRole('button',{name:msg('tags.title')+': Synthetic'});
 for(const action of [()=>fireEvent.doubleClick(tag),()=>fireEvent.keyDown(tag,{key:'F2'}),()=>fireEvent.keyDown(tag,{key:'ArrowDown',altKey:true}),()=>fireEvent.pointerDown(tag,{button:0,metaKey:true,ctrlKey:true})]){action();expect(screen.getByRole('tooltip').textContent).toBe(hint);expect(screen.getByRole('tooltip').className).toContain('restriction');}
 expect(rename).not.toHaveBeenCalled();expect(sort).not.toHaveBeenCalled();expect(reorder).not.toHaveBeenCalled();expect(screen.queryByRole('textbox',{name:msg('tags.projectTagPath')})).toBeNull();
 expect(screen.getByRole('button',{name:msg('tags.sortName')})).toHaveProperty('disabled',true);
});
