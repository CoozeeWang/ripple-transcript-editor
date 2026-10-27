/** Actual editor and store with synthetic in-memory audio; all API transports are mocked. */
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import { AIConnectorProvider } from '../src/components/AIConnectorProvider';
import { createModel, defaultMetadata } from '../src/localStore';
import { setInterfaceLanguage, type InterfaceLanguage } from '../src/i18n';
import type { ProviderInfo, Transcript } from '../src/types';
import { syntheticDirectory, syntheticTree, syntheticWave } from './syntheticProjectDirectory';
import '../src/styles.css';

const query = new URLSearchParams(location.search);
await setInterfaceLanguage((query.get('lang') || 'zh-CN') as InterfaceLanguage);
localStorage.setItem('ripple-mcp-enabled', '0');
const tree = syntheticTree(), audio = 'Synthetic interview.wav';
tree.files.set(audio, syntheticWave());
const directory = syntheticDirectory(tree, 'Synthetic project');
const original: Transcript = { audio:{ filename:audio, duration:1 }, speakers:[{id:'sp',name:'Synthetic speaker'}],
  segments:[{ id:'one', speaker_id:'sp', start:0, end:1, text:'Synthetic interview content for UI review.' }] };
const edited = structuredClone(original);
edited.segments[0].annotations = [{ id:'human-note', text:'Synthetic retained human annotation.', createdAt:'2026-01-01' }];
edited.segments[0].highlights = [{ id:'human-mark', start:0, end:9 }];
await createModel(directory, audio, { engine:'Synthetic old engine', original, transcript:edited, metadata:defaultMetadata('示例访谈_20261020.m4a') });
const providers: ProviderInfo[] = ['elevenlabs','tencent'].map(id=>({id,name:id==='elevenlabs'?'ElevenLabs':'腾讯云录音文件识别（标准版）',configured:true,models:[],credential_fields:[],
  capabilities:{diarization:true,language_selection:true,speaker_count_hint:true,audio_events:id==='elevenlabs',word_timestamps:true}}));
let submissions = 0, pending: ((success: boolean) => void) | null = null;
const proof = () => {
  document.querySelector('#proof')!.textContent = `Synthetic API submissions: ${submissions}. No real uploads or provider calls.`;
  for (const id of ['success', 'failure']) document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = !pending;
};
window.fetch = async (input, options) => {
  const url = String(input);
  if (url === '/api/providers') return Response.json(providers);
  if (url === '/api/credentials/default') return Response.json({ default_profile:{ provider_id:'elevenlabs', profile_id:'default' } });
  if (/^\/api\/providers\/(elevenlabs|tencent)\/credentials$/.test(url)) return Response.json({ active_profile_id:'default', profiles:[
    { id:'default', name:'Synthetic default account', is_default:true }, { id:'other', name:'Synthetic second account', is_default:false },
  ] });
  if (url.endsWith('/activate')) return Response.json({ok:true});
  if (url.startsWith('/api/transcribe/progress')) return Response.json({active:true,phase:'processing'});
  if (options?.method === 'DELETE' && url.startsWith('/api/transcribe/jobs/')) return Response.json({ok:true});
  if (url.includes('/connector/') || url.includes('/credentials')) return Response.json({configured:false,profiles:[]});
  throw new Error(`Synthetic fixture blocked unexpected request: ${url}`);
};
class SyntheticXHR {
  upload: { onprogress?: (event: {lengthComputable:boolean;loaded:number;total:number})=>void; onload?:()=>void } = {};
  status = 0; responseText = '';
  onload?:()=>void; onerror?:()=>void; ontimeout?:()=>void; onabort?:()=>void; onloadend?:()=>void;
  open(method: string, url: string) { if(method!=='POST'||url!=='/api/transcribe')throw Error('Synthetic XHR denied'); }
  send() { submissions++; pending=success=>this.finish(success); proof(); this.upload.onprogress?.({lengthComputable:true,loaded:1,total:1});this.upload.onload?.(); }
  abort() { this.onabort?.(); this.onloadend?.(); pending=null; proof(); }
  finish(success: boolean) {
    this.status = success ? 200 : 502;
    this.responseText = JSON.stringify(success ? { ...original, segments:[{...original.segments[0], text:'Synthetic newly recognized original.'}] }
      : { detail:{ code:'upstream_error', message:'Synthetic provider failure' } });
    this.onload?.(); this.onloadend?.(); pending=null; proof();
  }
}
window.XMLHttpRequest = SyntheticXHR as unknown as typeof XMLHttpRequest;
document.querySelector('#review-tools')!.innerHTML = '<span>Synthetic review</span><button id="success">Simulate success</button><button id="failure">Simulate failure</button><output id="proof"></output>';
document.querySelector('#success')!.addEventListener('click', ()=>pending?.(true));
document.querySelector('#failure')!.addEventListener('click', ()=>pending?.(false));
proof();
const style = document.createElement('style');
style.textContent = '#review-tools{height:42px;padding:7px 14px;display:flex;align-items:center;gap:12px;background:#e9ece4;font:12px system-ui}#review-tools button{font:inherit;padding:4px 9px}#proof{margin-left:auto;font-size:10px}.app-shell{height:calc(100dvh - 42px)}';
document.head.append(style);
createRoot(document.getElementById('root')!).render(<AIConnectorProvider><App projectDirectory={directory} projectLabel="Synthetic project" recordingLabel="示例访谈_20261020.m4a" onReturnToProjects={()=>{}}/></AIConnectorProvider>);
