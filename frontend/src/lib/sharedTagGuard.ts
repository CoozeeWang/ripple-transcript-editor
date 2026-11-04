import {msg} from '../i18n';
import {showActionHint} from './actionHint';
export const sharedTagRestriction=()=>msg('tags.sharedAiRestriction');
export function isSharedTagRestriction(error:unknown):boolean{
 let value=error;for(let i=0;i<5&&value instanceof Error;i++,value=value.cause)if(value.message==='tag_shared_ai_restricted')return true;return false;
}
export function sharedTagRestrictionMessage(error:unknown):string{
 if(typeof error==='string')return error;let value=error;
 for(let i=0;i<5&&value instanceof Error;i++,value=value.cause){const message=(value as Error&{restrictionMessage?:string}).restrictionMessage;if(message)return message;}return sharedTagRestriction();
}
export function rejectSharedTagStructure(message=sharedTagRestriction()):never{throw Object.assign(Error('tag_shared_ai_restricted'),{restrictionMessage:message});}
export function showSharedTagRestriction(target?:HTMLElement|null,error?:unknown){if(typeof document!=='undefined')showActionHint(target??(document.activeElement instanceof HTMLElement?document.activeElement:document.body),sharedTagRestrictionMessage(error),'restriction');}

export function assertSharedTagLibraryUnchanged(blocked:boolean,before:unknown,after:unknown,message=sharedTagRestriction()){if(blocked&&JSON.stringify(before)!==JSON.stringify(after))rejectSharedTagStructure(message);}
