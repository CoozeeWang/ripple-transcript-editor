import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ConnectorContext } from './connectorContext';
import { type ConnectorHost } from '../lib/aiConnector';
import type { AIEditActivity } from '../lib/aiEditOwnership';
import { blocksHumanEditing } from '../lib/aiEditOwnership';
import { ProjectAIConnector } from '../lib/projectAIConnector';
import type { ProjectConnectorAccess } from '../lib/projectConnectorHost';
import type { ContinuationProgress } from '../lib/incrementalContinuation';
import { nativeDesktopAvailable } from '../lib/desktopFs';
import { loadBooleanPreference, saveBooleanPreference } from '../lib/preferences';

export const CONNECTOR_ENABLED_KEY = 'ripple-mcp-enabled';

export function useAIConnector(host: ConnectorHost, context = '', projectAccess?: ProjectConnectorAccess) {
  const shared = useContext(ConnectorContext);
  const token = useRef({});
  const register = shared?.register, unregister = shared?.unregister;
  useLayoutEffect(() => { register?.(token.current, host, context, projectAccess); });
  useLayoutEffect(() => { const owner = token.current; return () => unregister?.(owner); }, [unregister]);
  if (!shared) throw Error('connector_window_provider_required');
  return shared.state;
}

export function useAIConnectorRuntime(host: ConnectorHost, context = '', projectAccess?: ProjectConnectorAccess) {
  const latest = useRef(host);
  const project = useRef(projectAccess);
  useLayoutEffect(() => { latest.current = host; project.current = projectAccess; });
  const [enabled, updateEnabled] = useState(() => loadBooleanPreference(CONNECTOR_ENABLED_KEY, false));
  const [attempt, setAttempt] = useState(0);
  const setEnabled = (value: boolean) => { saveBooleanPreference(CONNECTOR_ENABLED_KEY, value); updateEnabled(value); };
  const [status, setStatus] = useState<'off' | 'connecting' | 'ready' | 'error'>('off');
  const [tasks,setTasks]=useState<ContinuationProgress[]>([]);
  const [activities,setActivities]=useState<AIEditActivity[]>([]);
  const [taskFeedback,setTaskFeedback]=useState<{message:string;background:boolean}|null>(null);
  const taskError=taskFeedback?.message ?? '';
  const setTaskError=useCallback((message:string,background=false)=>setTaskFeedback(message?{message,background}:null),[]);
  const [journalWarnings, setJournalWarnings] = useState<Record<string, { count: number; projectId: string }>>({});
  const controllerRef=useRef<ProjectAIConnector|null>(null);
  const projectIdentity=useRef<string | null>(null);
  const generation=useRef(0);
  // Page-local receipts have a shorter lifetime than durable connector tasks.
  const feedbackScope = JSON.stringify([context, projectAccess?.project()?.data.id ?? '']);
  const feedbackOwner = useRef(feedbackScope);
  const feedbackGeneration = useRef(0);
  useLayoutEffect(() => {
    if (feedbackOwner.current === feedbackScope) return;
    feedbackOwner.current = feedbackScope;
    feedbackGeneration.current++;
    setTaskError('');
  }, [feedbackScope,setTaskError]);
  const dismissTaskError = useCallback(() => { feedbackGeneration.current++; setTaskError(''); }, [setTaskError]);
  const createController=useCallback((valid:()=>boolean=()=>true)=>new ProjectAIConnector({current:()=>latest.current.current(),publish:(...args)=>latest.current.publish(...args),
    applyMarks:(...args)=>{if(!latest.current.applyMarks)throw Error('marks_unavailable');return latest.current.applyMarks(...args);},
    editingActivity:next=>{if(valid())setActivities(next);},
    continuationWarning:(scope, count)=>{
      if (!valid()) return;
      const projectId=project.current?.project()?.data.id ?? '';
      setJournalWarnings(previous=>previous[scope]?.count===count&&previous[scope]?.projectId===projectId?previous:{...previous,[scope]:{count,projectId}});
    },
    continuationProgress:next=>{if(valid())setTasks(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);}},
    ()=> valid() && project.current ? { ...project.current, project: () => valid() ? project.current?.project() ?? null : null } : undefined),[]);
  const taskAction=useCallback(async(operation:string,task_id?:string,background=false)=>{
    const controller=controllerRef.current ?? (controllerRef.current=createController());
    const owner = feedbackGeneration.current;
    try {
      const result = await controller.handle(operation, task_id ? {task_id} : {}, 'window');
      if (owner === feedbackGeneration.current) setTaskError('');
      return result;
    } catch (error) {
      if (owner === feedbackGeneration.current) {
        const message = error instanceof Error ? error.message : 'continuation_unavailable';
        setTaskError(['no_editable_interview','interview_changed'].includes(message) ? '' : message, Boolean(task_id)||background);
        if (['no_editable_interview','interview_changed'].includes(message)) setTasks([]);
      }
      throw error;
    }
  },[createController,setTaskError]);
  useEffect(()=>{
    const nextProject = project.current?.project()?.data.id ?? '';
    if (projectIdentity.current !== nextProject) {
      generation.current++;
      controllerRef.current?.editing.endAll('project_changed');
      projectIdentity.current = nextProject;
      const currentGeneration = generation.current;
      controllerRef.current = createController(() => generation.current === currentGeneration);
      setActivities([]); setTasks([]); setJournalWarnings({});
    }
    if(!context)return;
    let disposed=false;
    const owner=feedbackGeneration.current;
    const controller=controllerRef.current ?? (controllerRef.current=createController());
    void controller.handle('tasks',{}).then(()=>{if(!disposed&&owner===feedbackGeneration.current)setTaskError('');}).catch(error=>{
      if(disposed||owner!==feedbackGeneration.current)return;
      const message=error instanceof Error?error.message:'continuation_unavailable';
      setTaskError(['no_editable_interview','interview_changed'].includes(message)?'':message);
      if(['no_editable_interview','interview_changed'].includes(message))setTasks([]);
    });
    return()=>{disposed=true;};
  },[context,createController,setTaskError]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const abort = new AbortController();
    const session = crypto.randomUUID();
    let token = '';
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const controller = controllerRef.current ?? (controllerRef.current=createController());
    async function request(path: string, body?: unknown, signal?: AbortSignal) {
      const response = await fetch(`/api/connector/${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal });
      if (!response.ok) throw new Error('connector_unavailable');
      return response.json();
    }
    async function run() {
      setStatus('connecting');
      if (!nativeDesktopAvailable()) throw new Error('desktop_required');
      const tauri = (window as unknown as { __TAURI__: { core: { invoke: (name: string) => Promise<string | boolean> } } }).__TAURI__;
      token = String(await tauri.core.invoke('connector_window_key'));
      if (disposed) return;
      await request('session', { session, enabled: true }, abort.signal);
      if (disposed) return;
      // A remote tunnel failure must not disable configured local clients.
      await tauri.core.invoke('connector_tunnel_start').catch(() => {});
      heartbeat = setInterval(() => {
        void request('session', { session, enabled: true }, abort.signal).catch(() => { if (!disposed) setStatus('connecting'); });
      }, 5000);
      while (!disposed) {
        const ready = await tauri.core.invoke('connector_local_ready');
        if (disposed) return;
        setStatus(ready ? 'ready' : 'connecting');
        let call;
        try {
          // Re-establish an expired lease without changing consent or dropping task state.
          await request('session', { session, enabled: true }, abort.signal);
          call = await request(`poll?session=${encodeURIComponent(session)}`, undefined, abort.signal);
        } catch {
          if (disposed) return;
          setStatus('connecting');
          controllerRef.current?.editing.interruptAll('connection_lost');
          await new Promise<void>(resolve => {
            const finish = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', finish); resolve(); };
            const timer = setTimeout(finish, 1000);
            abort.signal.addEventListener('abort', finish, { once: true });
          });
          continue;
        }
        if (!call || disposed) continue;
        let result;
        try { result = { ok: true, data: await (controllerRef.current ?? controller).handle(call.operation, call.arguments, call.client) }; }
        catch (error) { result = { ok: false, error: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'editor_operation_failed_check_ripple' }; }
        // An expired broker wait must not discard the controller's completed result or stop polling.
        // Status queries recover it; never replay an uncertain write automatically.
        if (!disposed) await request('reply', { session, request_id: call.request_id, result }, abort.signal).catch(() => {
          if (!disposed) setStatus('connecting');
        });
      }
    }
    void run().catch(() => {
      if (heartbeat) clearInterval(heartbeat);
      controllerRef.current?.editing.interruptAll('connection_failed');
      if (!disposed) { setStatus('error'); if (token) void request('session', { session, enabled: false }).catch(() => {}); }
    });
    return () => {
      disposed = true; abort.abort();
      controllerRef.current?.editing.interruptAll('connection_disabled');
      if (heartbeat) clearInterval(heartbeat);
      if (token) void request('session', { session, enabled: false }).catch(() => {});
      if (nativeDesktopAvailable()) {
        const tauri = (window as unknown as { __TAURI__: { core: { invoke: (name: string) => Promise<void> } } }).__TAURI__;
        void tauri.core.invoke('connector_tunnel_stop').catch(() => {});
      }
    };
  }, [enabled, attempt,createController]);
  const targetLocked = (version: string, recording?: string, interview?: string, projectId?: string, identity?: string) =>
    controllerRef.current?.editing.values().some(task => blocksHumanEditing(task) && (task.target
      ? (!version || task.target.version_id === version) && task.target.recording_id === recording && task.target.interview_id === interview && task.target.project_id === projectId
      : task.version_id === version && (identity === undefined || task.key === JSON.stringify([identity, version])))) ?? false;
  const visibleTasks = tasks.map(task => {
    const activity = activities.find(item => item.task_id === task.task_id);
    return activity?.kind === 'incremental' && activity.state === 'ended' && task.state === 'draft'
      ? { ...task, state: 'paused' as const, reason: activity.reason } : task;
  });
  const recoveryProjectIds = Object.values(journalWarnings).filter(warning => warning.count > 0).map(warning => warning.projectId);
  const recoveryWarning = recoveryProjectIds.length ? 'continuation_journal_unreadable' : '';
  return { enabled, setEnabled, reconnect: () => setAttempt(value => value + 1), status: enabled ? status : 'off' as const,activities,tasks:visibleTasks,taskError:taskError || recoveryWarning,taskActionError:taskFeedback?.background?taskError:'',recoveryWarning,recoveryProjectIds,dismissTaskError,taskAction,targetLocked };
}
