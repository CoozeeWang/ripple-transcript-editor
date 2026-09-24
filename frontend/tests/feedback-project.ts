/** B4 synthetic empty, audio-free and offline-reference cases. */
import {addInterview,addRecordings,createProject,saveProject,recordingDirectory,rememberProject} from '../src/lib/projectStore';
import {createModel,defaultMetadata} from '../src/localStore';
import type {Transcript} from '../src/types';
export async function createFeedbackProject(parent:FileSystemDirectoryHandle,files:FileSystemDirectoryHandle){
 let project=await addInterview(await createProject(parent,`B4_反馈_${Date.now().toString(36)}`),'空场次');
 project=await addInterview(project,'离线音频与独立文稿');
 const sceneId=project.data.interviews[1].id;
 project=await addRecordings(project,sceneId,[await files.getFileHandle('静音测试.wav')],'copy');
 const scene=project.data.interviews[1],audio=scene.recordings[0];
 const independent={id:crypto.randomUUID(),name:'独立合成稿',file:'standalone.wav',storage:'none' as const,fingerprint:''};
 // Mark only this new fixture as an unavailable reference. No source file is deleted.
 project=await saveProject(project,{...project.data,interviews:project.data.interviews.map(s=>s.id===sceneId?{...s,recordings:[{...audio,storage:'reference'},independent]}:s)});
 const transcript:Transcript={audio:{filename:'静音测试.wav',duration:10},speakers:[{id:'s',name:'受访者'}],segments:[{id:'s1',speaker_id:'s',start:0,end:10,text:'这份合成文稿在音频离线时仍应可以阅读和编辑。'}]};
 for(const r of project.data.interviews[1].recordings)await createModel(await recordingDirectory(project,sceneId,r),r.file,{engine:'qa',label:r.storage==='none'?'独立合成稿':'离线音频合成稿',transcript:r.storage==='none'?{...transcript,timeAligned:false}:transcript,original:transcript,metadata:defaultMetadata('B4 合成访谈'),editLabel:'修改稿 v1'});
 await rememberProject(project);return project.directory.name;
}
