/** Real project board/editor over synthetic in-memory files. No provider transport is allowed. */
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import { ProjectWorkspace } from '../src/components/ProjectWorkspace';
import { AIConnectorProvider } from '../src/components/AIConnectorProvider';
import { createEdit, createModel, defaultMetadata, persistActiveModel, readModelEdit, stemOf } from '../src/localStore';
import { addInterview, addRecordings, createProject, recordingDirectory } from '../src/lib/projectStore';
import { setInterfaceLanguage, type InterfaceLanguage } from '../src/i18n';
import type { Transcript, TranscriptManifest } from '../src/types';
import { syntheticDirectory, syntheticTree, syntheticWave } from './syntheticProjectDirectory';
import '../src/styles.css';

const query=new URLSearchParams(location.search),language=(query.get('lang')||'zh-CN') as InterfaceLanguage;
await setInterfaceLanguage(language);
localStorage.setItem('ripple-mcp-enabled','0');localStorage.setItem('ripple-open-last-project','0');
window.fetch=async input=>Response.json(String(input)==='/api/providers'?[]:{configured:false,engines:[],default_engine_id:null,providers:[],profiles:[]});
class BlockedXHR { open(){throw Error('Synthetic fixture blocks all uploads');} }
window.XMLHttpRequest=BlockedXHR as unknown as typeof XMLHttpRequest;
const tree=syntheticTree(),parent=syntheticDirectory(tree,'Synthetic root');
let project=await createProject(parent,'示例归属项目');project=await addInterview(project,'示例访谈');
const inputs=syntheticTree();inputs.files.set('示例访谈_20261020.wav',syntheticWave());
project=await addRecordings(project,project.data.interviews[0].id,[await syntheticDirectory(inputs,'Synthetic input').getFileHandle('示例访谈_20261020.wav')],'copy');
const session=project.data.interviews[0],recording=session.recordings[0],directory=await recordingDirectory(project,session.id,recording);
const original:Transcript={audio:{filename:recording.file,duration:1},speakers:[{id:'sp',name:'示例说话人'}],segments:[
  {id:'segment',speaker_id:'sp',start:0,end:1,text:'这是一段用于检查原稿归属的合成访谈内容。',words:[{text:'这是一段用于检查原稿归属的合成访谈内容。',start:0,end:1}],
   annotations:[{id:'note',text:'合成批注：保留原有标记。',createdAt:'2026-01-01'}],highlights:[{id:'highlight',start:0,end:6}]},
]};
const metadata=defaultMetadata(recording.name);
const a=await createModel(directory,recording.file,{engine:'ElevenLabs',label:'原始稿 A · ElevenLabs',original,transcript:original,originalOnly:true,metadata});
const a1=await createEdit(directory,recording.file,a.model.id,{fromOriginal:true,label:'人工校订 A1'});
const baseline=(await readModelEdit(directory,recording.file,a1.model.id,a1.edit.id))!.transcript;
await createEdit(directory,recording.file,a1.model.id,{srcEditId:a1.edit.id,reviewed:{baseline,transcript:baseline,label:'AI 校订 A2'}});
await createEdit(directory,recording.file,a.model.id,{fromOriginal:true,label:'补充版本 A3'});
const b=await createModel(directory,recording.file,{engine:'Tencent',label:'原始稿 B · 腾讯云',original,transcript:original,originalOnly:true,metadata});
await createEdit(directory,recording.file,b.model.id,{fromOriginal:true,label:'人工校订 B1'});
await createModel(directory,recording.file,{engine:'imported',sourceKind:'import',sourceName:'外部导入稿.txt',label:'外部导入稿.txt',transcript:original,metadata});
await persistActiveModel(directory,recording.file,a1.model.id);
if(query.get('legacy')==='1'){
  const folder=await directory.getDirectoryHandle(`${stemOf(recording.file)}.transcript`),handle=await folder.getFileHandle('manifest.json');
  const manifest=JSON.parse(await (await handle.getFile()).text()) as TranscriptManifest;
  manifest.models=manifest.models.map(({originalGroupId:_group,...model})=>{void _group;return model;});
  const writer=await handle.createWritable();await writer.write(JSON.stringify(manifest));await writer.close();
}
Object.assign(window,{showDirectoryPicker:async()=>project.directory});
export function Harness(){
  useEffect(()=>{
    if(query.get('view')==='editor')return;
    const timer=window.setTimeout(()=>window.dispatchEvent(new Event('ripple-open-project')),30);
    return()=>clearTimeout(timer);
  },[]);
  return <AIConnectorProvider>{query.get('view')==='editor'
    ? <App projectDirectory={directory} recordingLabel={recording.name} projectLabel={project.data.title} onReturnToProjects={()=>location.assign(`?lang=${language}`)}/>
    : <ProjectWorkspace/>}</AIConnectorProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
