import {useEffect,useState} from 'react';
import {msg,useInterfaceLanguage} from '../i18n';
import {OriginalAudioInfo} from './OriginalAudioInfo';
import type {OriginalAudioInfo as Info} from '../lib/originalAudioInfo';
import {formatPlaybackTime} from '../lib/format';
import {readLegacyPreparation} from '../lib/legacyAudioPreparation';
export interface AudioSource {dir:FileSystemDirectoryHandle;audio:string;info?:Info;seconds:number}
export function AudioSourceFacts({source}:{source:AudioSource}){
 useInterfaceLanguage();
 const [retained,setRetained]=useState<string|null>(null);
 useEffect(()=>{let active=true;void readLegacyPreparation(source.dir,source.audio).then(p=>{if(active)setRetained(p?source.audio:null)}).catch(()=>{if(active)setRetained(source.audio)});return()=>{active=false}},[source.dir,source.audio]);
 return <div className="audio-source-facts">
  {source.info&&<OriginalAudioInfo info={source.info} labeled lowercase/>}
  <span>{msg('audioInformation.duration',{duration:source.seconds>0?formatPlaybackTime(source.seconds):'--:--:--'})}</span>
  {retained===source.audio&&<p className="settings-hint" role="status">{msg('audioRecovery.retained')}</p>}
 </div>;
}
