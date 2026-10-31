import type { ConnectorHost, ConnectorDocument } from './aiConnector';
import {readProjectTagCounts} from './projectTagRepository';
import { AIEditOwnership } from './aiEditOwnership';
import { ProjectConnectorHosts, type ProjectConnectorAccess } from './projectConnectorHost';
import { applyTagBatch, tagBatchScope, validateTagChanges, TAG_ACTIONS, type TagChange } from './tagBatch';
import { transactProjectTags, TagRequestAlreadySaved } from './projectTagRepository';
import { projectTagCatalog, versionTagCollection, TagCollectionConflict, TagMergeRequired } from './tagCollections';
import { tagPath, tagTreeRows, TagTreeError } from './tags';
import { tagSegmentCounts,tagCoverageCounts } from './tagPresentation';
import type { OpenProject, TagRequestReceipt } from './projectStore';

interface Target { interview_id:string;recording_id:string;version_id:string }
interface Context { bound:Awaited<ReturnType<ProjectConnectorHosts['bind']>>;doc:ConnectorDocument;project:OpenProject }
interface Snapshot { id:string;target:Target;projectId:string;fingerprint:string;client:string }
interface Task { id:string;snapshot:Snapshot;changes:TagChange[];signature:string;summary:string;client:string;
    scope:'current'|'project';state:'draft'|'applying'|'completed'|'cancelled'|'failed';result?:Record<string,unknown>;promise?:Promise<Record<string,unknown>> }
function error(code:string):never{throw Error(code)}
function details(error:unknown){
    if(error instanceof TagCollectionConflict)return{error:'tag_collection_name_conflict',conflicting_version:error.consumer,paths:error.paths};
    if(error instanceof TagMergeRequired)return{error:'tag_merge_confirmation_required',source_id:error.sourceId,target_id:error.targetId,path:error.path,instruction:'Prepare an explicit merge_tag operation or choose another name/path.'};
    if(error instanceof TagTreeError)return{error:'tag_'+error.code,value:error.value};
    return{error:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'tag_batch_failed_check_ripple'};
}
async function digest(value:unknown){const bytes=new TextEncoder().encode(JSON.stringify(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')}
const tagSignature=(context:Context)=>digest([context.project.data.tagLibrary??null,context.doc.tagBodyRevision??null,context.doc.transcript.tagCollection??null,
    context.doc.transcript.segments.map(s=>[s.id,s.text,s.speaker_id,s.start,s.end,s.tagIds])]);
const requestResult=(id:string,receipt:TagRequestReceipt)=>({saved:true,task_id:id,state:receipt.undone?'undone':'completed',currently_applied:!receipt.undone,
    operation_count:receipt.count,references:receipt.references,undo_available:false,recording_id:receipt.recording,model_id:receipt.model,edit_id:receipt.version});

/** Tags use exact project targets and the existing application transaction, never a backend file-write channel. */
export class ProjectTagTasks {
    private snapshots=new Map<string,Snapshot>();private tasks=new Map<string,Task>();
    constructor(private hosts:ProjectConnectorHosts,private active:ConnectorHost,private access:()=>ProjectConnectorAccess|undefined,private editing:AIEditOwnership){}
    has(id:string){return this.tasks.has(id)}
    async cancel(id:string,client:string){
        const task=this.tasks.get(id);if(!task)error('tag_task_expired_check_status');
        if(client!=='window'&&task!.client!==client)error('editing_task_belongs_to_another_client');
        if(task!.state==='completed')return{cancelled:false,already_saved:true};
        this.editing.end(id);
        if(task!.state==='applying')return{cancelled:false,in_flight:true,instruction:'A commit already in progress may finish. Query tag_changes_status before another write.'};
        task!.state='cancelled';return{cancelled:true};
    }
    private async context(target:Target):Promise<Context>{
        if(![target.interview_id,target.recording_id,target.version_id].every(v=>typeof v==='string'&&v.length>0))error('exact_tag_version_required');
        const bound=await this.hosts.bind(target.interview_id,target.recording_id,target.version_id),doc=await bound.tagsCurrent(),project=await this.hosts.project();
        return{bound,doc,project};
    }
    private async validate(snapshot:Snapshot){
        const next=await this.context(snapshot.target);
        if(next.project.data.id!==snapshot.projectId||await tagSignature(next)!==snapshot.fingerprint)error('tag_snapshot_changed_read_again');
        return next;
    }
    private assert(task:Task){
        this.editing.assert(task.id,task.client);
        if(this.access()?.project()?.data.id!==task.snapshot.projectId)error('project_changed_read_directory_again');
    }
    async handle(operation:string,a:Record<string,unknown>,client:string):Promise<Record<string,unknown>>{
        if(operation==='tags_read'){
            const target={interview_id:String(a.interview_id??''),recording_id:String(a.recording_id??''),version_id:String(a.version_id??'')};
            const context=await this.context(target),library=projectTagCatalog(context.project.data.tagLibrary??{schemaVersion:3,tags:[],groups:[]}),collection=versionTagCollection(context.doc.transcript,context.project.data.tagLibrary??library);
            const scope=a.scope===undefined?'current':a.scope;if(!['current','project'].includes(String(scope)))error('invalid_tag_scope');
            const cursor=a.cursor===undefined?0:Number(a.cursor),limit=a.limit===undefined?100:Number(a.limit);
            if(!Number.isInteger(cursor)||cursor<0||cursor>context.doc.transcript.segments.length||!Number.isInteger(limit)||limit<1||limit>200)error('invalid_tag_page');
            const id=crypto.randomUUID(),snapshot={id,target,projectId:context.project.data.id,fingerprint:await tagSignature(context),client};
            if(this.snapshots.size>=32)this.snapshots.delete(this.snapshots.keys().next().value!);this.snapshots.set(id,snapshot);
            const counts=scope==='project'&&context.project.data.schemaVersion===2?await readProjectTagCounts(context.project):tagSegmentCounts(library,context.doc.transcript.segments),members=scope==='project'?undefined:new Set(collection.tagIds);
            const coverage=scope==='project'&&'coverage'in counts?counts.coverage as Map<string,number>:tagCoverageCounts(library,context.doc.transcript.segments);
            return{tag_snapshot:id,target:context.bound.target(),editable:context.project.data.schemaVersion===2&&context.doc.editable!==false,storage_upgrade_required:context.project.data.schemaVersion!==2,scope,allowed_actions:TAG_ACTIONS,
                tags:tagTreeRows(library,members).map(({tag,depth})=>({id:tag.id,name:tag.name,parent_id:tag.parentId??null,path:tagPath(library,tag.id),depth,count:counts.get(tag.id)??0,coverage_count:coverage.get(tag.id)??0,admitted:collection.tagIds.includes(tag.id)})),
                groups:collection.groups,display_order:{level:collection.levelOrder??[],ungrouped:collection.ungroupedOrder??[]},segments:context.doc.transcript.segments.slice(cursor,cursor+limit).map(s=>({id:s.id,tag_ids:s.tagIds??[]})),
                next_cursor:cursor+limit<context.doc.transcript.segments.length?String(cursor+limit):null,
                instruction:'Counts include only explicit matching tag IDs, without descendant aggregation: current scope uses this version and project scope sums all saved versions independently. Display orders are version-local and group orders are independent. Assignments are version-local. Read-only originals cannot be changed. Shared rename/move/merge/delete require explicit project scope; a parent query includes descendants but assigning a parent assigns only that ID.'};
        }
        if(operation==='tags_prepare'){
            const snapshot=this.snapshots.get(String(a.tag_snapshot));if(!snapshot)error('tag_snapshot_expired_read_again');
            if(snapshot!.client!==client)error('editing_task_belongs_to_another_client');
            const context=await this.validate(snapshot!);if(context.doc.editable===false||context.doc.version.kind==='original')error('select_editable_version_in_ripple');
            if(context.project.data.schemaVersion!==2)error('tag_storage_migration_required');
            const changes=validateTagChanges(a.changes,a.allowed_actions),scope=String(a.scope??'');if(!['current','project'].includes(scope))error('explicit_tag_scope_required');
            if(tagBatchScope(changes)==='project'&&scope!=='project')error('project_tag_scope_required');
            if(this.tasks.size>=64)error('too_many_tag_tasks_restart_connection');
            const library=projectTagCatalog(context.project.data.tagLibrary??{schemaVersion:3,tags:[],groups:[]});
            try{applyTagBatch(library,[{id:'preview',label:context.doc.label,transcript:context.doc.transcript}],'preview',changes)}catch(error){return{ready:false,saved:false,...details(error)}}
            const id=crypto.randomUUID(),signature=await digest([snapshot!.fingerprint,scope,changes]),summary=JSON.stringify({target:context.bound.target(),scope,allowed_actions:[...new Set(changes.map(c=>c.action))],changes});
            this.editing.acquire(id,client,context.doc,'tags',changes.length,scope==='project');
            const task:Task={id,snapshot:snapshot!,changes,signature,summary,client,scope:scope as 'current'|'project',state:'draft'};this.tasks.set(id,task);
            return{task_id:id,summary,target:context.bound.target(),operation_count:changes.length,scope,
                instruction:'Preview only; nothing saved. Agree on this exact target, changes and scope, then pass the unchanged summary to apply_tag_changes. Project changes affect all consuming versions and will be validated atomically. Cancel if not approved.'};
        }
        const id=String(a.task_id??''),task=this.tasks.get(id),project=await this.hosts.project(),receipt=project.data.tagRequests?.[id];
        if(receipt&&receipt.client!==client&&client!=='window')error('editing_task_belongs_to_another_client');
        if(operation==='tags_status'){
            if(receipt)return requestResult(id,receipt);
            if(!task) return{task_id:id,state:'unknown',saved:false,retry_safe:false,instruction:'No saved receipt in the current project. Do not replay an uncertain batch; inspect Ripple and recovery state first.'};
            if(task.client!==client&&client!=='window')error('editing_task_belongs_to_another_client');
            return{task_id:id,state:task.state,result:task.result??null,summary:task.summary};
        }
        if(operation==='tags_cancel')return this.cancel(id,client);
        if(operation!=='tags_apply')error('unknown_operation');
        if(receipt)return requestResult(id,receipt);
        if(!task)error('tag_task_expired_check_status');
        if(task!.client!==client)error('editing_task_belongs_to_another_client');
        if(task!.promise)return task!.promise;
        if(task!.state!=='draft')error('tag_task_not_editable');
        if(a.confirmed_summary!==task!.summary)error('confirm_tag_summary_first');
        this.assert(task!);task!.state='applying';this.editing.update(id,{state:'saving',inFlight:1});
        task!.promise=(async()=>{
            try{
                // A shared change must first flush the active editor, even when its precise target is another version.
                if((task!.scope==='project'||(await this.hosts.bind(task!.snapshot.target.interview_id,task!.snapshot.target.recording_id,task!.snapshot.target.version_id)).isActive())&&this.access()?.active().version_id)await this.active.current();
                const context=await this.validate(task!.snapshot);this.assert(task!);
                let references={tags:{} as Record<string,string>,groups:{} as Record<string,string>};
                const result=await transactProjectTags(context.project,{recordingId:context.doc.target!.recording_id,modelId:context.doc.version.model_id,editId:context.doc.version.edit_id,transcript:context.doc.transcript},
                    (library,consumers,currentId)=>{this.assert(task!);const result=applyTagBatch(library,consumers,currentId,task!.changes);references=result.references;return result},tagBatchScope(task!.changes),{
                        id,signature:task!.signature,client,assert:()=>this.assert(task!),receipt:()=>({signature:task!.signature,client,recording:context.doc.target!.recording_id,model:context.doc.version.model_id,version:context.doc.version.edit_id,
                            count:task!.changes.length,savedAt:new Date().toISOString(),references}),
                    });
                let undo=false,refreshFailed=false;
                if(this.access()?.project()?.data.id===context.project.data.id){
                    try{await this.access()?.publishTagProject?.(result.project);
                        if(result.changed&&(context.bound.isActive()||task!.scope==='project'))undo=await this.active.acceptTagTransaction?.(result.receipt)??false;
                        this.access()?.onSaved?.(context.bound.target());
                    }catch{refreshFailed=true}
                }
                task!.state='completed';task!.result={saved:true,task_id:id,target:context.bound.target(),operation_count:task!.changes.length,references,
                    undo_available:undo,background:!context.bound.isActive(),new_version_created:false,view_refresh_failed:refreshFailed,reason:result.changed?'saved':'no_changes'};
                this.editing.update(id,{state:'completed',processed:task!.changes.length,saved:task!.changes.length,inFlight:0});return task!.result;
            }catch(error){
                if(error instanceof TagRequestAlreadySaved){task!.state='completed';task!.result=requestResult(id,error.receipt);this.editing.update(id,{state:'completed',saved:task!.changes.length,inFlight:0});return task!.result;}
                task!.state='failed';this.editing.update(id,{state:'failed',reason:'tag_batch_failed',inFlight:0});
                task!.result={saved:false,task_id:id,...details(error),retry_safe:false,
                    instruction:'No automatic replay. Query tag_changes_status and inspect Ripple/recovery before preparing another batch.'};return task!.result;
            }
        })();return task!.promise;
    }
}
