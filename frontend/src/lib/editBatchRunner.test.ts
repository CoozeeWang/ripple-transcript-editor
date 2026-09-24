import { expect, it, vi } from "vitest";
import { runEditBatches } from "./editBatchRunner";
function deferred<T>() { let resolve!:(value:T)=>void; let reject!:(error:Error)=>void; const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
it("limits concurrent work and retains input order when replies arrive out of order",async()=>{
 const pending=[deferred<number>(),deferred<number>(),deferred<number>()];
 const request=vi.fn((i:number)=>pending[i].promise);const save=vi.fn(async()=>{});
 const work=runEditBatches([0,1,2],new AbortController().signal,request,save);
 expect(request).toHaveBeenCalledTimes(2);
 pending[1].resolve(1);await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(3));
 pending[2].resolve(2);pending[0].resolve(0);
 expect(await work).toEqual([0,1,2]);expect(save).toHaveBeenLastCalledWith([0,1,2],3,[{index:0,value:0},{index:1,value:1},{index:2,value:2}]);
});
it("aborts the sibling on failure without launching another request",async()=>{
 const request=vi.fn((i:number,signal:AbortSignal)=>i===0?Promise.reject(new Error("failed")):new Promise<number>((_,reject)=>signal.addEventListener("abort",()=>reject(new Error("aborted")))));
 const save=vi.fn(async()=>{});
 await expect(runEditBatches([0,1,2],new AbortController().signal,request,save)).rejects.toThrow("failed");
 expect(request).toHaveBeenCalledTimes(2);expect(save).not.toHaveBeenCalled();
});
it("ignores late responses after cancellation",async()=>{
 const pending=deferred<number>();const controller=new AbortController();const save=vi.fn(async()=>{});
 const work=runEditBatches([0,1,2],controller.signal,()=>pending.promise,save);
 controller.abort();pending.resolve(1);expect(await work).toEqual([]);expect(save).not.toHaveBeenCalled();
});
it("stops requests if checkpoint persistence fails",async()=>{
 const request=vi.fn(async(i:number)=>i);
 await expect(runEditBatches([0,1,2],new AbortController().signal,request,async()=>{throw new Error("disk");})).rejects.toThrow("disk");
 expect(request).toHaveBeenCalledTimes(2);
});
it("resumes sparse completed batches without requesting them again", async()=>{
 const request=vi.fn(async(i:number)=>i); const save=vi.fn(async()=>{});
 expect(await runEditBatches([0,1,2,3],new AbortController().signal,request,save,new Map([[1,1],[3,3]]))).toEqual([0,1,2,3]);
 expect(request.mock.calls.map(c=>c[0])).toEqual([0,2]);
});
it("finishes an already received checkpoint when a sibling request fails",async()=>{
 const checkpoint=deferred<void>(), failure=deferred<number>();
 const save=vi.fn(()=>checkpoint.promise);
 const work=runEditBatches([0,1,2],new AbortController().signal,async i=>i===0?0:failure.promise,save);
 const outcome=expect(work).rejects.toThrow('connection');
 await vi.waitFor(()=>expect(save).toHaveBeenCalledOnce());
 failure.reject(new Error('connection'));checkpoint.resolve();await outcome;
 expect(save).toHaveBeenCalledWith([0],1,[{index:0,value:0}]);
});
