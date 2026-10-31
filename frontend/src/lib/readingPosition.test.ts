// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {loadReadingAnchor,saveReadingAnchor} from './readingPosition';
afterEach(()=>{localStorage.clear();delete(window as Window & {__TAURI__?:unknown}).__TAURI__});
it('waits for the small native preference flush and loads it independently of WebKit localStorage',async()=>{
 let finish!:()=>void;const pending=new Promise<void>(r=>{finish=r}),anchor={id:'synthetic',index:3,paragraph:0,offset:0,fraction:.5};
 const invoke=vi.fn(async(name:string)=>name==='reading_position_write'?pending:anchor);
 Object.assign(window,{__TAURI__:{core:{invoke}}});let complete=false;
 const save=saveReadingAnchor('ripple-reading-position-v1:synthetic',anchor).then(()=>{complete=true});await Promise.resolve();expect(complete).toBe(false);
 finish();await save;expect(complete).toBe(true);localStorage.clear();expect(await loadReadingAnchor('ripple-reading-position-v1:synthetic')).toEqual(anchor);
});
