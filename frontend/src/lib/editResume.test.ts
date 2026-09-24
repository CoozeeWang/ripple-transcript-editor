import {expect,it} from 'vitest';
import {resumeResults,type EditResume} from './editResume';
const selection=['a','b','c'].map(id=>({id,text:'原文',speaker_id:'s',start:0,end:1}));
const checkpoint:EditResume={version:1,signature:'exact rules and engine',batches:[['a'],['b'],['c']],completed:[{index:1,segments:[{id:'b',text:'原文',reason:''}]}]};
it('retains unchanged completed batches and sparse indices',()=>{
 expect([...resumeResults(checkpoint,selection,checkpoint.signature).keys()]).toEqual([1]);
});
it('rejects changed request settings, scope and damaged completed batches',()=>{
 expect(()=>resumeResults(checkpoint,selection,'changed')).toThrow('已变化');
 expect(()=>resumeResults(checkpoint,[...selection].reverse(),checkpoint.signature)).toThrow('范围');
 expect(()=>resumeResults({...checkpoint,completed:[{index:1,segments:[]}]},selection,checkpoint.signature)).toThrow('不完整');
 expect(()=>resumeResults({...checkpoint,completed:[...checkpoint.completed,...checkpoint.completed]},selection,checkpoint.signature)).toThrow('不完整');
});
