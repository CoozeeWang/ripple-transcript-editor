// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {useStableCallbacks} from "./useStableCallbacks";
it("keeps memoized children stable but calls the latest handler",()=>{
 const first=vi.fn(),second=vi.fn();
 const {result,rerender}=renderHook(({callback})=>useStableCallbacks({callback}),{initialProps:{callback:first}});
 const handlers=result.current;
 rerender({callback:second});
 expect(result.current).toBe(handlers);
 act(()=>result.current.callback("latest"));
 expect(first).not.toHaveBeenCalled();
 expect(second).toHaveBeenCalledWith("latest");
});
