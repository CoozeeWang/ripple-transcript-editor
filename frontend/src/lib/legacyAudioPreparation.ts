/** Read compatibility only for conversion records written by older installations.
 * No preparation, repair, replacement, cleanup or submission API is provided.
 */
import {msg} from '../i18n';
import type {TranscriptionOptions} from '../types';
export interface LegacyAudioPreparation {
 schema:1;provider:string;source:string;format:'m4a'|'wav'|'flac';purpose:'temporary'|'replace';
 file:string;identity:string;sourceIdentity:string;state:'preparing'|'ready'|'saved';
 configuration?:{options:TranscriptionOptions;profileId?:string};
 backup?:{folder:string;file:string;identity:string};
}
const journal=(audio:string)=>`.${audio}.audio-preparation.json`;
export async function readLegacyPreparation(dir:FileSystemDirectoryHandle,audio:string):Promise<LegacyAudioPreparation|null>{
 let raw:string;
 try{raw=await(await(await dir.getFileHandle(journal(audio))).getFile()).text()}catch(error){if(error instanceof DOMException&&error.name==='NotFoundError')return null;throw error}
 const p=JSON.parse(raw) as LegacyAudioPreparation;
 if(p.schema!==1||typeof p.provider!=='string'||!/^\.ripple-work-[a-f0-9-]+\.(m4a|wav|flac)$/.test(p.file)||p.source!==audio||!['preparing','ready','saved'].includes(p.state)||!['m4a','wav','flac'].includes(p.format)||!['temporary','replace'].includes(p.purpose)||!/^\d+:[a-f0-9]{64}$/.test(p.sourceIdentity))throw Error(msg('audioRecovery.retained'));
 if(p.state!=='preparing'&&!/^\d+:[a-f0-9]{64}$/.test(p.identity))throw Error(msg('audioRecovery.retained'));
 if(p.backup&&(!/^Ripple-audio-backup-[a-f0-9-]+$/.test(p.backup.folder)||!p.backup.file||/[\\/\0]/.test(p.backup.file)||p.backup.file==='.'||p.backup.file==='..'))throw Error(msg('audioRecovery.retained'));
 return p;
}
