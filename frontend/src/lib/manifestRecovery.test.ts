import {expect,it} from "vitest";
import {readRecoverableManifest,writeRecoverableManifest,type ManifestIO} from "./manifestRecovery";
const index=(file="edit.json")=>JSON.stringify({schemaVersion:2,audio:"a.wav",activeModelId:"m1",models:[{id:"m1",activeEditId:"e1",edits:[{id:"e1",file}]}]});
const body=JSON.stringify({transcript:{segments:[{text:"测试正文"}]}});
function fixture(){
 const files=new Map([["manifest.json",index()],["edit.json",body]]);
 const io:ManifestIO={read:async name=>files.get(name)??null,write:async(name,text)=>{files.set(name,text);}};
 return {files,io};
}
it("reads a complete orphan swap without changing any files",async()=>{
 const {files,io}=fixture();files.set("manifest.crswap",files.get("manifest.json")!);files.delete("manifest.json");
 const before=[...files];expect(await readRecoverableManifest(io)).toBe(index());expect([...files]).toEqual(before);
});
it("prefers canonical index, then verified backup, over an uncommitted swap",async()=>{
 const {files,io}=fixture();files.set("manifest.crswap",index("other.json"));files.set("other.json",body);files.set("manifest.json.bak",index());
 expect(await readRecoverableManifest(io)).toBe(index());
 files.set("manifest.json","broken");expect(await readRecoverableManifest(io)).toBe(index());
});
it.each(["{",index("missing.json"),index("../secret.json")])("rejects malformed or incomplete recovery candidates",async candidate=>{
 const {files,io}=fixture();files.delete("manifest.json");files.set("manifest.crswap",candidate);
 await expect(readRecoverableManifest(io)).rejects.toThrow("不完整");
});
it("rejects a candidate referencing a corrupt manuscript",async()=>{
 const {files,io}=fixture();files.delete("manifest.json");files.set("manifest.crswap",index());files.set("edit.json","{");
 await expect(readRecoverableManifest(io)).rejects.toThrow();
});
it("backs up and verifies the index before replacing it",async()=>{
 const {files,io}=fixture();await writeRecoverableManifest(io,index("next.json"));
 expect(files.get("manifest.json.bak")).toBe(index());expect(files.get("manifest.json")).toBe(index("next.json"));
});
it("a failed backup never replaces the canonical index",async()=>{
 const {files,io}=fixture();io.write=async()=>{throw new Error("disk unavailable");};
 await expect(writeRecoverableManifest(io,index("next.json"))).rejects.toThrow("备份失败");expect(files.get("manifest.json")).toBe(index());
});
it("restores the old index when close loses the canonical file",async()=>{
 const {files,io}=fixture();const write=io.write;let fail=true;
 io.write=async(name,text)=>{if(name==="manifest.json"&&fail){fail=false;files.delete(name);files.set("manifest.crswap",text);throw new Error("close failed");}await write(name,text);};
 await expect(writeRecoverableManifest(io,index("next.json"))).rejects.toThrow("已恢复");
 expect(files.get("manifest.json")).toBe(index());expect(files.get("manifest.json.bak")).toBe(index());
});
it("keeps the backup readable when both publish and rollback fail",async()=>{
 const {files,io}=fixture();const write=io.write;
 io.write=async(name,text)=>{if(name==="manifest.json"){files.delete(name);throw new Error("close failed");}await write(name,text);};
 await expect(writeRecoverableManifest(io,index("next.json"))).rejects.toThrow("备份仍然保留");
 expect(await readRecoverableManifest(io)).toBe(index());
});
it("detects a silently truncated final file and restores the old index",async()=>{
 const {files,io}=fixture();const write=io.write;let fail=true;
 io.write=async(name,text)=>{if(name==="manifest.json"&&fail){fail=false;files.set(name,"{");return;}await write(name,text);};
 await expect(writeRecoverableManifest(io,index("next.json"))).rejects.toThrow("已恢复");expect(files.get("manifest.json")).toBe(index());
});
it("does not bypass revoked permissions with a fallback",async()=>{
 const {io}=fixture();io.read=async()=>{throw new DOMException("denied","NotAllowedError");};
 await expect(readRecoverableManifest(io)).rejects.toMatchObject({name:"NotAllowedError"});
});
