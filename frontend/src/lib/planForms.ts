export interface EditingPlan {id:string;name:string;instructions:string;common?:boolean;updated_at?:string}
interface Rule {title?:string;text:string;checked:boolean}
interface Form {generated?:boolean;id:string;name:string;rules:Rule[];common:boolean}
export interface PlanForms {mode?:"common"|"custom"|"extracted";custom:Form;extracted:Form;first:number;last:number}
export const emptyPlanForms=():PlanForms=>({custom:{id:"",name:"",rules:[{text:"",checked:true}],common:false},extracted:{id:"",name:"",rules:[{text:"",checked:true}],common:false},first:0,last:0});


export const formInstructions=(form:Form)=>form.rules.filter(r=>r.checked&&r.text.trim()).map(r=>r.title?.trim()?`${r.title.trim()}：${r.text.trim()}`:r.text.trim()).join("\n\n");

// Keep old rules recoverable, without resuming the retired testing workflow.
export function restorePlanForms(options: {forms?:PlanForms;planId?:string;planName?:string;planInstructions?:string;learned?:{text:string;checked:boolean}[]}|undefined, trial:import("./revisions").TrialState|undefined, plans:EditingPlan[]):PlanForms {
  const forms=options?.forms??emptyPlanForms();
  const validId=(id:string)=>plans.some(p=>p.id===id)?id:"";
  const restored:PlanForms={...forms,custom:{...forms.custom,id:validId(forms.custom.id),rules:forms.custom.rules.map(r=>r.title!==undefined?r:{...parsePlanRule(r.text),checked:r.checked})},extracted:{...forms.extracted,id:validId(forms.extracted.id),rules:forms.extracted.rules.map(r=>r.title!==undefined?r:{...parsePlanRule(r.text),checked:r.checked})}};
  if(trial?.candidates.length){
    restored.mode="extracted";
    restored.extracted={generated:true,id:"",name:options?.planName??"",common:false,rules:trial.candidates.map((text,index)=>{
      const change=trial.candidateChanges?.find(c=>c.index===index);
      return {...parsePlanRule(text),checked:!(change?.conflict&&!change.decision)&&!(change&&!change.before&&change.decision==="keep")};
    })};
  } else if(!options?.forms&&options?.learned?.length){
    restored.mode="extracted";restored.extracted={generated:true,id:"",name:options.planName??"",common:false,rules:options.learned.map(r=>({...parsePlanRule(r.text),checked:r.checked}))};
  } else if((!restored.mode||restored.mode==="common")&&options?.planInstructions&&!options.planId?.startsWith("builtin:")&&!plans.some(p=>p.id===options.planId)){
    restored.mode="custom";restored.custom={id:"",name:options.planName??"",common:false,rules:options.planInstructions.split(/\n\n+/).map(parsePlanRule)};
  }
  return restored;
}

export function parsePlanRule(value:string):{title?:string;text:string;checked:boolean}{
  const match=value.match(/^([^：:\n]{1,32})[：:]\s*([\s\S]+)$/);
  return match?{title:match[1].trim(),text:match[2].trim(),checked:true}:{text:value,checked:true};
}
