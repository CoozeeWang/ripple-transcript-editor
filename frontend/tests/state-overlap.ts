/** B2 uses the real project/editor with synthetic audio and two versions. */
import { addInterview, addRecordings, createProject, recordingDirectory, rememberProject } from '../src/lib/projectStore';
import { createModel, defaultMetadata } from '../src/localStore';
import type { Transcript } from '../src/types';
export async function createStateOverlap(parent: FileSystemDirectoryHandle, files: FileSystemDirectoryHandle) {
  let project = await addInterview(await createProject(parent, `B2_状态叠加_${Date.now().toString(36)}`), '书店访谈（合成）');
  project = await addRecordings(project, project.data.interviews[0].id, [await files.getFileHandle('静音测试.wav')], 'copy');
  const scene = project.data.interviews[0], recording = scene.recordings[0];
  const original: Transcript = {audio:{filename:recording.name,duration:40},speakers:[{id:'a',name:'采访者'},{id:'b',name:'受访者'}],segments:[
    '河岸书店每周六举办读书活动。\n这句话保留分段。',
    '我们最初准备了三百本书，后来又增加了一批。',
    '参加活动的人可以留下批注，也可以标记喜欢的句子。',
    '最后一句：保留慢慢聊天的时间。',
  ].map((text,i)=>({id:`b2-${i+1}`,speaker_id:i%2?'b':'a',text,start:i*10,end:(i+1)*10,words:Array.from(text).map((text,j,chars)=>({text,start:i*10+j*10/chars.length,end:i*10+(j+1)*10/chars.length}))}))};
  const edited: Transcript = {...original,segments:original.segments.map((s,i)=>({...s,text:i===0?s.text.replace('河岸','河边'):i===1?s.text.replace('三百','三百二十'):s.text,
    highlights:i===0?[{id:'b2-highlight',start:0,end:12}]:[],annotations:i===0?[{id:'b2-note',text:'核对活动日期，保留原话中的不确定表达。',createdAt:'2026-09-22T10:00:00Z'}]:[]}))};
  await createModel(await recordingDirectory(project,scene.id,recording),recording.file,{engine:'qa',label:'书店合成稿',transcript:edited,original,metadata:defaultMetadata('书店访谈 · 状态叠加'),editLabel:'修改稿 v1'});
  await rememberProject(project);
  return project.directory.name;
}
