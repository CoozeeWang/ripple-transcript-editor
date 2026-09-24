// Synthetic component-only review. No files, network calls or project mutations.
import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MergeDialog,NamingModal,MatchDialog} from '../src/components/Dialogs';
import {useDismissable} from '../src/useDismissable';
import type {MatchPrompt} from '../src/hooks/useImport';
import '../src/styles.css';
const sample:MatchPrompt={sourceName:'合成文稿.json',target:'原录音.wav',candidates:['访谈甲.wav','访谈乙.wav'],choice:'访谈甲.wav',warning:null,checking:false,transcript:{audio:{filename:'原录音.wav',duration:0},speakers:[],segments:[]}};
export function Review(){
 const [mode,setMode]=useState('');const [error,setError]=useState<string|null>(null);const [repairs,setRepairs]=useState<string[]>([]);const [match,setMatch]=useState<MatchPrompt|null>(sample);const ref=useRef<HTMLDivElement>(null);
 useDismissable(ref,!!mode,()=>setMode(''));
 return <main style={{padding:24}}><h1>C3 弹层键盘验收</h1><p>合成场景，仅验证真实组件的键盘与可访问性；不导入、合并或写入文件。</p>
 <button onClick={()=>setMode('naming')}>检查命名</button><button onClick={()=>setMode('merge')}>检查合并</button><button onClick={()=>{setMatch(sample);setMode('match');}}>检查匹配</button><button onClick={()=>{setMatch({...sample,warning:'合成警告：时长不匹配。'});setMode('match');}}>检查匹配警告</button>
 {mode==='naming'&&<NamingModal value="新修改稿" error={error} setError={setError} busy={false} repairs={repairs} setRepairs={setRepairs} modalRef={ref} setOpen={()=>setMode('')} confirmNaming={()=>setMode('')}/>}
 {mode==='merge'&&<MergeDialog prompt={{sourceId:'a',targetId:'b',sourceName:'采访者',targetName:'受访者',trigger:'merge'}} dialogRef={ref} setPrompt={()=>setMode('')} confirmMerge={()=>setMode('')}/>}
 {mode==='match'&&match&&<MatchDialog prompt={match} dialogRef={ref} setPrompt={v=>{setMatch(v);if(v===null)setMode('');}} finishImport={()=>setMode('')} confirmMatch={()=>setMode('')}/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
