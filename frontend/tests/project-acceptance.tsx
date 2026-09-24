/** Development-only harness. Real app and disk-backed browser storage; simulated
 * picker choices and API responses. Never accesses user projects or cloud APIs. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createFeedbackProject } from './feedback-project';
import { createStateOverlap } from './state-overlap';
import { createContentStress } from './content-stress';
import { ProjectWorkspace } from '../src/components/ProjectWorkspace';
import '../src/styles.css';
import shortText from '../../docs/acceptance-kit-2026-09-22/01_正常材料/01_短文稿.txt?raw';
import speakers from '../../docs/acceptance-kit-2026-09-22/01_正常材料/03_两位说话人.json?raw';
import longText from '../../docs/acceptance-kit-2026-09-22/01_正常材料/05_长文稿_1200段.txt?raw';

const root = await navigator.storage.getDirectory();
const files = await root.getDirectoryHandle('qa-inputs', { create: true });
const projects = await root.getDirectoryHandle('qa-projects', { create: true });
const exports = await root.getDirectoryHandle('qa-exports', { create: true });
for (const [name, text] of [['短文稿.txt',shortText],['两位说话人.json',speakers],['长文稿.txt',longText],['空白.txt',''],['苹果.txt','苹果的文稿'],['梨子.txt','梨子的文稿']]) {
  const h = await files.getFileHandle(name,{create:true});const w=await h.createWritable();await w.write(text);await w.close();
}
// Forty seconds of silence, solely for playback/association mechanics.
const wave = new Uint8Array(44 + 8000 * 40 * 2), view = new DataView(wave.buffer);
const ascii = (offset:number,text:string) => [...text].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
ascii(0,'RIFF');view.setUint32(4,wave.length-8,true);ascii(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,wave.length-44,true);
const waveFile=await files.getFileHandle('静音测试.wav',{create:true});const waveWriter=await waveFile.createWritable();await waveWriter.write(wave);await waveWriter.close();
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const path=String(input);
  if(!path.startsWith('/api/'))return originalFetch(input,init);
  let body:unknown=[];
  if(path.includes('/config'))body={configured:false,engines:[],default_engine_id:null};
  else if(path.includes('/profiles'))body={profiles:[],default_profile_id:null};
  return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
};
let selectedFile='短文稿.txt';let target='qa-projects';
Object.assign(window,{
  showOpenFilePicker:async()=>[await files.getFileHandle(selectedFile)],
  showDirectoryPicker:async()=>{
    if(target==='cancel')throw new DOMException('Cancelled','AbortError');
    if(target==='qa-projects')return projects;
    if(target==='qa-exports')return exports;
    return projects.getDirectoryHandle(target);
  },
});
export function Harness(){
 const [dirs,setDirs]=useState<string[]>([]);
 const [selectedTarget,setSelectedTarget]=useState(target);
 const [stressStatus,setStressStatus]=useState('');
 const [seeding,setSeeding]=useState(false);
 const seedStress=async()=>{setSeeding(true);setStressStatus('正在生成隔离合成材料…');try{const folder=await createContentStress(projects,files);target=folder;setDirs(previous=>[...previous,folder]);setSelectedTarget(folder);setStressStatus('已生成 B1 项目，请点击打开项目。');}catch(error){setStressStatus(String(error));}finally{setSeeding(false);}};
 const seedOverlap=async()=>{setSeeding(true);setStressStatus('正在生成 B2 状态材料…');try{const folder=await createStateOverlap(projects,files);target=folder;setDirs(previous=>[...previous,folder]);setSelectedTarget(folder);setStressStatus('已生成 B2 项目，请点击打开项目。');}catch(error){setStressStatus(String(error));}finally{setSeeding(false);}};
 const seedFeedback=async()=>{setSeeding(true);try{const folder=await createFeedbackProject(projects,files);target=folder;setDirs(previous=>[...previous,folder]);setSelectedTarget(folder);setStressStatus('已生成 B4 项目，请点击打开项目。');}catch(error){setStressStatus(String(error));}finally{setSeeding(false);}};
 const refresh=async()=>{const found:string[]=[];for await(const [name,h]of projects.entries())if(h.kind==='directory')found.push(name);setDirs(found);};
 return <div className="qa-project-harness"><style>{`.qa-project-harness { display:flex;flex-direction:column;height:100dvh; } .qa-project-harness > details { flex:none; } .qa-project-harness > .project-home, .qa-project-harness > .app-shell { flex:1;min-height:0;height:auto; }`}</style><details style={{padding:8,borderBottom:'1px solid #ccc'}} open><summary>隔离验收：使用浏览器内部测试文件；文件窗口与服务响应为模拟，不调用真实引擎</summary>
 <label>下一份测试文稿 <select aria-label="下一份测试文稿" onChange={e=>{selectedFile=e.target.value;}}>{['短文稿.txt','两位说话人.json','长文稿.txt','空白.txt','苹果.txt','梨子.txt','静音测试.wav'].map(n=><option key={n}>{n}</option>)}</select></label>
 <button onClick={()=>void refresh()}>刷新测试项目列表</button>
 <button disabled={seeding} onClick={()=>void seedStress()}>生成 B1 内容压力项目</button><button disabled={seeding} onClick={()=>void seedOverlap()}>生成 B2 状态叠加项目</button><button disabled={seeding} onClick={()=>void seedFeedback()}>生成 B4 反馈项目</button><span role="status">{stressStatus}</span>
 <label>文件夹选择结果 <select aria-label="文件夹选择结果" value={selectedTarget} onChange={e=>{target=e.target.value;setSelectedTarget(target);}}><option>qa-projects</option><option>qa-exports</option><option>cancel</option>{dirs.map(n=><option key={n}>{n}</option>)}</select></label>
 </details><ProjectWorkspace/></div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness/></StrictMode>);
