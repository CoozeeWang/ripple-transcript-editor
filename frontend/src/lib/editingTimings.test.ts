// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {readEditingTimings, startEditingTiming} from './editingTimings';
afterEach(()=>{localStorage.clear();vi.restoreAllMocks();});
it('measures phases without recording results', async()=>{
  let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
  const t=startEditingTiming(new AbortController().signal,32,6000);
  const result=await t.measure('request',async()=>{now=1250;return {text:'private transcript'};},1,32,6000);
  expect(result.text).toBe('private transcript');t.finish(true);
  const rows=readEditingTimings();
  expect(rows[0]).toMatchObject({phase:'request',ms:1250,batch:1,status:'ok',segments:32,characters:6000});
  expect(rows[1]).toMatchObject({phase:'total',ms:1250,status:'ok'});
  expect(JSON.stringify(rows)).not.toContain('private');
});
it('preserves failure and cancellation semantics',async()=>{
  const controller=new AbortController();const t=startEditingTiming(controller.signal,1,10);
  const failure=new Error('private filename and key');
  await expect(t.measure('checkpoint',async()=>{throw failure;})).rejects.toBe(failure);
  controller.abort();
  await expect(t.measure('request',async()=>{throw failure;})).rejects.toBe(failure);
  t.finish(false);
  expect(readEditingTimings().map(r=>r.status)).toEqual(['failed','cancelled','cancelled']);
  expect(JSON.stringify(readEditingTimings())).not.toContain(failure.message);
});
it('records successful publishing when dialog cleanup aborts before it returns',async()=>{
  const controller=new AbortController();
  const t=startEditingTiming(controller.signal,458,11708);
  const saved=await t.measure('publish',async()=>{
    // Publishing closes the dialog, whose unmount cleanup aborts the controller.
    controller.abort();
    return true;
  });
  t.finish(saved);
  expect(readEditingTimings().map(({phase,status})=>({phase,status}))).toEqual([
    {phase:'publish',status:'ok'},
    {phase:'total',status:'ok'},
  ]);
});
it('records publishing and total as failed when saving rejects',async()=>{
  const t=startEditingTiming(new AbortController().signal,1,10);
  await expect(t.measure('publish',async()=>{throw new Error('save failed');})).rejects.toThrow('save failed');
  t.finish(false);
  expect(readEditingTimings().map(r=>r.status)).toEqual(['failed','failed']);
});
it('bounds history, removes expired entries and strips unknown fields',async()=>{
  const t=startEditingTiming(new AbortController().signal,1,1);
  for(let i=0;i<105;i++) await t.measure('request',async()=>{},i+1,1,1);
  expect(readEditingTimings()).toHaveLength(105);
  const sample=readEditingTimings()[0];
  localStorage.setItem('ripple-editing-timings-v1',JSON.stringify([{...sample,run:crypto.randomUUID(),time:'2000-01-01T00:00:00.000Z'},{...sample,secret:'hidden'}]));
  expect(readEditingTimings()).toEqual([sample]);
});

it('retains the latest 20 entire runs even when their details exceed the old size limit',()=>{
  const runs=Array.from({length:21},()=>crypto.randomUUID());
  const rows=runs.flatMap((run,index)=>Array.from({length:106},(_,batch)=>({run,time:new Date(Date.now()-21000+index*1000).toISOString(),phase:'request',ms:10,status:'ok',batch,segments:1,characters:1})));
  localStorage.setItem('ripple-editing-timings-v1',JSON.stringify(rows));
  const kept=readEditingTimings();
  expect(kept).toHaveLength(20*106);
  expect(new Set(kept.map(r=>r.run))).toEqual(new Set(runs.slice(1)));
});
it('expires runs as a whole using their last activity',()=>{
  const run=crypto.randomUUID();
  const sample={run,phase:'prepare',ms:1,status:'ok',batch:0,segments:1,characters:1};
  const rows=[{...sample,time:new Date(Date.now()-8*86400000).toISOString()},{...sample,phase:'total',time:new Date().toISOString()}];
  localStorage.setItem('ripple-editing-timings-v1',JSON.stringify(rows));
  expect(readEditingTimings()).toEqual(rows);
});
