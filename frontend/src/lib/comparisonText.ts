import { msg } from '../i18n';
import { comparisonParts } from "./comparisonReview";

/** Display-only deletions never enter the editor's text, cursor offsets or saved manuscript. */
export function writeComparisonText(root: HTMLElement, value: string, before?: string, accepted: readonly string[] = [], interactive = false) {
  const fragment=document.createDocumentFragment();
  let paragraph=document.createElement("div");fragment.append(paragraph);
  const mark = (node: HTMLElement, key?:string) => {
    if (!key || !interactive) return;
    node.dataset.comparisonChange = key; node.tabIndex = 0;
    node.setAttribute("role","button"); node.setAttribute("aria-label",msg('comparisonText.m1249'));
  };
  const append=(text:string, inserted:boolean, key?:string)=>{
    text.split("\n").forEach((line,i)=>{
      if(i){if(key && interactive){const marker=document.createElement("span");marker.dataset.comparisonDeletion="true";marker.className="comparison-break";marker.textContent="↵";mark(marker,key);paragraph.append(marker);}if(!paragraph.childNodes.length)paragraph.append(document.createElement("br"));paragraph=document.createElement("div");fragment.append(paragraph);}
      if(!line)return;
      const node=document.createElement(inserted?"ins":"span");node.textContent=line;mark(node,key);paragraph.append(node);
    });
  };
  if(before===undefined) append(value,false);
  else for(const part of comparisonParts(before,value)){
    const pending = part.changed && !accepted.includes(part.key);
    if(pending&&part.before){const del=document.createElement("del");del.dataset.comparisonDeletion="true";del.contentEditable="false";del.textContent=part.before.replace(/\n/g,"↵");mark(del,part.key);paragraph.append(del);}
    append(part.after,pending,pending?part.key:undefined);
  }
  if(!paragraph.childNodes.length)paragraph.append(document.createElement("br"));
  root.replaceChildren(fragment);
}
