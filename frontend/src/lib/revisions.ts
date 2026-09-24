import type { Segment } from "../types";
import type { AISuggestion } from "./aiEditing";
import { mapCharsByDiff } from "./transcriptOps";

export type Choice = "pending" | "accept" | "reject";
export interface RevisionPart { before: string; after: string; changed: boolean; choice: Choice }
export interface RevisionState { parts: RevisionPart[]; operation: Choice; reviewed: boolean }
export function revisionFor(before: string, suggestion: AISuggestion): RevisionState {
  const after = suggestion.action === "delete" ? "" : suggestion.text;
  const mapping = mapCharsByDiff(before, after);
  const parts: RevisionPart[] = [];
  let a = 0, b = 0;
  const add = (old: string, next: string, changed: boolean) => {
    if (!old && !next) return;
    const last = parts.at(-1);
    if(last && last.changed === changed) {last.before += old;last.after += next;}
    else parts.push({before:old,after:next,changed,choice:changed?"pending":"accept"});
  };
  for(let j=0;j<after.length;j++) {
    const i=mapping[j];
    if(i<0 || i<a) continue;
    add(before.slice(a,i),after.slice(b,j),true);
    add(before[i],after[j],false); a=i+1;b=j+1;
  }
  add(before.slice(a),after.slice(b),true);
  return {parts,operation:suggestion.action && suggestion.action!=="edit" ? "pending":"accept",reviewed:false};
}
export function revisionText(state: RevisionState): string {
  return state.parts.map(p=>p.choice === "reject" ? p.before : p.after).join("");
}
export function revisionDone(state: RevisionState): boolean {
  return state.reviewed && state.operation!=="pending" && state.parts.every(p=>p.choice!=="pending");
}
export function decideRevision(state: RevisionState, choice: "accept"|"reject"): RevisionState {
  return {...state, reviewed:true, operation:choice, parts:state.parts.map(p=>({...p,choice:p.changed?choice:p.choice}))};
}
export function resolvedSuggestion(_original: Segment, suggestion: AISuggestion, state: RevisionState): AISuggestion {
  const action = suggestion.action && suggestion.action!=="edit" && state.operation === "accept" ? suggestion.action : "edit";
  const text = revisionText(state);
  return {...suggestion,action:!text.trim()?"delete":action,text:action === "delete"?"":text};
}

// Read-only compatibility types for drafts created before testing was retired.
export type EditingStrength = "light" | "medium" | "strong";
export interface TrialVariants {
  proposals: Record<EditingStrength,AISuggestion[]>;
  edits: Partial<Record<EditingStrength,Record<string,RevisionState>>>;
  active: Record<string,EditingStrength>;
  chosen: Record<string,EditingStrength|"original">;
}
export interface TrialState { sourcePlan?:import("./planForms").EditingPlan; ownershipRecorded?:boolean; feedbackNote?:string; ownedPlan?:{id:string;name:string;common:boolean}; candidateChanges?:{index:number;before:string;after:string;reason:string;conflict:boolean;decision?:"keep"|"replace"}[]; optimizationResolved?:boolean; variants?: TrialVariants; history?: {feedbackNote?:string;round:number;suggestions:AISuggestion[];reviews:Record<string,RevisionState>;variants?:TrialVariants}[]; round:number; ids:string[]; suggestions:AISuggestion[]; reviews:Record<string,RevisionState>; candidates:string[]; complete:boolean }

/** Repair oversized legacy diff runs without changing text or review decisions. */
export function refineRevisionParts(state: RevisionState): RevisionState {
  let changed = false;
  const parts = state.parts.flatMap(part => {
    if (!part.changed || part.before.length * part.after.length <= 250000) return [part];
    const refined = revisionFor(part.before, { id: "", text: part.after, reason: "" }).parts;
    if (!refined.some(p => !p.changed)) return [part];
    changed = true;
    return refined.map(p => ({ ...p, choice: p.changed ? part.choice : "accept" as Choice }));
  });
  return changed ? { ...state, parts } : state;
}
