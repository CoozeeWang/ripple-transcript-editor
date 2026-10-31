/** Public, in-memory test filesystem. No operating-system files or permissions. */
export interface SyntheticTree { files: Map<string, Uint8Array>; folders: Map<string, SyntheticTree> }
export const syntheticTree = (): SyntheticTree => ({ files:new Map(), folders:new Map() });
const modified=new WeakMap<Uint8Array,number>();let clock=1;
const timestamp=(bytes:Uint8Array)=>{if(!modified.has(bytes))modified.set(bytes,clock++);return modified.get(bytes)!};
export function syntheticDirectory(tree:SyntheticTree,name:string,blockIndexWrite:()=>boolean=()=>false):FileSystemDirectoryHandle {
 const missing=()=>new DOMException('Synthetic missing entry','NotFoundError');
 const getFileHandle=async(name:string,options?:{create?:boolean})=>{
  if(!tree.files.has(name)){if(!options?.create)throw missing();tree.files.set(name,new Uint8Array());}
  return {kind:'file',name,getFile:async()=>new File([tree.files.get(name)!.slice().buffer],name,{lastModified:timestamp(tree.files.get(name)!)}),
   getMetadata:async()=>({size:tree.files.get(name)!.byteLength,modified:String(timestamp(tree.files.get(name)!))}),createWritable:async()=>{
   if(name==='ripple-project.json'&&blockIndexWrite())throw new DOMException('Synthetic index write blocked','NotAllowedError');
   const chunks:BlobPart[]=[],write=async(chunk:BlobPart)=>{chunks.push(chunk);},close=async()=>{tree.files.set(name,new Uint8Array(await new Blob(chunks).arrayBuffer()));};
   return Object.assign(new WritableStream({write,close}),{write,close,abort:async()=>{}});
  }} as unknown as FileSystemFileHandle;
 };
 return {kind:'directory',name,getFileHandle,queryPermission:async()=>'granted',requestPermission:async()=>'granted',
  getDirectoryHandle:async(child:string,options?:{create?:boolean})=>{if(!tree.folders.has(child)){if(!options?.create)throw missing();tree.folders.set(child,syntheticTree());}return syntheticDirectory(tree.folders.get(child)!,child,blockIndexWrite);},
  removeEntry:async(child:string)=>{tree.files.delete(child);tree.folders.delete(child);},
  async *entries(){for(const file of tree.files.keys())yield[file,await getFileHandle(file)];for(const [child,folder]of tree.folders)yield[child,syntheticDirectory(folder,child,blockIndexWrite)];},
 } as unknown as FileSystemDirectoryHandle;
}
export function syntheticWave(){
 const bytes=new Uint8Array(16044),v=new DataView(bytes.buffer),ascii=(at:number,text:string)=>[...text].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
 ascii(0,'RIFF');v.setUint32(4,bytes.length-8,true);ascii(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,bytes.length-44,true);return bytes;
}
