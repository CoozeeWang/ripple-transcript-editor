/** Synthetic-only diagnostics for the isolated release-test bundle. Never records text or paths. */
import type {ProfilerOnRenderCallback} from 'react';
const enabled=import.meta.env.VITE_RIPPLE_RELEASE_TEST==='1';
interface Probe {visibility:string;focused:boolean;kind:string;started:number;root?:FileSystemDirectoryHandle;phases:Record<string,number>;commands:Record<string,{count:number;ms:number;readBytes:number;writeBytes:number}>;cards:number;commits:number;renderMs:number;scheduled:boolean}
let active:Probe|undefined;
const sessions=new Map<number,string>();
function role(args:unknown){
    const parts=(args as {parts?:string[]})?.parts??[],name=parts.at(-1)??'';
    if(name==='.ripple-tag-performance.json')return'diagnostic';
    if(parts.includes('.ripple-tag-backups'))return'backup';
    if(name.startsWith('.ripple-'))return'journal';
    if(parts.some(p=>p.endsWith('.transcript'))&&name.endsWith('.json')&&!name.startsWith('tags-')&&!name.startsWith('manifest')&&name!=='tag-storage.json'&&!name.startsWith('ai-'))return'body';
    return'metadata';
}
export function recordTagBridge(command:string,args:unknown,result:unknown,ms:number,headers?:Record<string,string>){
    if(!enabled||!command.startsWith('fs_'))return;
    let category=role(args);
    if(command==='fs_begin_write'&&typeof result==='number')sessions.set(result,category);
    if(command==='fs_write_chunk')category=sessions.get(Number(headers?.['x-ripple-write-id']))??'metadata';
    if(command==='fs_commit_write'||command==='fs_abort_write'){category=sessions.get((args as {id:number}).id)??category;sessions.delete((args as {id:number}).id)}
    if(!active||category==='diagnostic')return;
    const key=category+':'+command,row=active.commands[key]??={count:0,ms:0,readBytes:0,writeBytes:0};row.count++;row.ms+=ms;
    if(command==='fs_read_chunk')row.readBytes+=result instanceof ArrayBuffer?result.byteLength:Array.isArray(result)?result.length:0;
    if(command==='fs_write_chunk')row.writeBytes+=(args as Uint8Array).byteLength??0;
}
export function beginTagProbe(kind:string,root?:FileSystemDirectoryHandle,projectId?:string){
    if(!enabled||!projectId?.startsWith('synthetic-'))return undefined;
    if(active){const probe=active;if(root)probe.root=root;return{mark:(name:string)=>mark(probe,name),finish:()=>{}}}
    const probe:Probe={visibility:typeof document==='undefined'?'unknown':document.visibilityState,focused:typeof document!=='undefined'&&document.hasFocus(),kind,started:performance.now(),root,phases:{},commands:{},cards:0,commits:0,renderMs:0,scheduled:false};active=probe;
    return{mark:(name:string)=>mark(probe,name),finish:()=>finish(probe)};
}
function mark(probe:Probe,name:string){probe.phases[name]=performance.now()-probe.started}
export function recordTagCardRender(){if(enabled&&active)active.cards++}
export const recordTagReactCommit:ProfilerOnRenderCallback=(_id,_phase,actualDuration)=>{if(enabled&&active){active.commits++;active.renderMs+=actualDuration;mark(active,'lastReactCommit')}};
function finish(probe:Probe){
    if(probe.scheduled)return;probe.scheduled=true;mark(probe,'commandFinished');
    const save=async()=>{
        if(active!==probe)return;mark(probe,'afterFrames');active=undefined;if(!probe.root)return;
        try{
            const name='.ripple-tag-performance.json';let records:unknown[]=[];
            try{records=JSON.parse(await(await(await probe.root.getFileHandle(name)).getFile()).text()).records??[]}catch{/* new synthetic log */}
            const {root:_root,started:_started,scheduled:_scheduled,...record}=probe;void _root;void _started;void _scheduled;
            const stream=await(await probe.root.getFileHandle(name,{create:true})).createWritable();
            await stream.write(JSON.stringify({scope:'Isolated release-test, synthetic project only; bridge timings include native IPC. Frame callbacks are not hardware display latency.',records:[...records.slice(-99),record]},null,2));await stream.close();
        }catch{/* diagnostics never change the command result */}
    };
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(()=>{void save()}));
    setTimeout(()=>{void save()},120);
}
