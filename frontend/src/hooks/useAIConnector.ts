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
  const [taskError,setTaskError]=useState('');
  const controllerRef=useRef<ProjectAIConnector|null>(null);
  const projectIdentity=useRef<string | null>(null);
  const generation=useRef(0);
  const createController=useCallback((valid:()=>boolean=()=>true)=>new ProjectAIConnector({current:()=>latest.current.current(),publish:(...args)=>latest.current.publish(...args),
    applyMarks:(...args)=>{if(!latest.current.applyMarks)throw Error('marks_unavailable');return latest.current.applyMarks(...args);},
    editingActivity:next=>{if(valid())setActivities(next);},
    continuationProgress:next=>{if(valid())setTasks(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);}},
    ()=> valid() && project.current ? { ...project.current, project: () => valid() ? project.current?.project() ?? null : null } : undefined),[]);
  const taskAction=useCallback(async(operation:string,task_id?:string)=>{
    const controller=controllerRef.current ?? (controllerRef.current=createController());
    try{const result=await controller.handle(operation,task_id?{task_id}:{},'window');setTaskError('');return result;}
    catch(error){const message=error instanceof Error?error.message:'continuation_unavailable';setTaskError(['no_editable_interview','interview_changed'].includes(message)?'':message);if(['no_editable_interview','interview_changed'].includes(message))setTasks([]);throw error;}
  },[createController]);
  useEffect(()=>{
    const nextProject = project.current?.project()?.data.id ?? '';
    if (projectIdentity.current !== nextProject) {
      generation.current++;
      controllerRef.current?.editing.endAll('project_changed');
      projectIdentity.current = nextProject;
      const currentGeneration = generation.current;
      controllerRef.current = createController(() => generation.current === currentGeneration);
      setActivities([]); setTasks([]);
    }
    if(!context)return;
    let disposed=false;
    const controller=controllerRef.current ?? (controllerRef.current=createController());
    void controller.handle('tasks',{}).then(()=>{if(!disposed)setTaskError('');}).catch(error=>{
      if(disposed)return;
      const message=error instanceof Error?error.message:'continuation_unavailable';
      setTaskError(['no_editable_interview','interview_changed'].includes(message)?'':message);
      if(['no_editable_interview','interview_changed'].includes(message))setTasks([]);
    });
    return()=>{disposed=true;};
  },[context,createController]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const abort = new AbortController();
    const session = crypto.randomUUID();
    let token = '';
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const controller = controllerRef.current ?? (controllerRef.current=createController());
    const expiry = setInterval(()=>controllerRef.current?.editing.sweep(),1000);
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
          controllerRef.current?.editing.endAll('connection_lost');
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
      controllerRef.current?.editing.endAll('connection_failed');
      if (!disposed) { setStatus('error'); if (token) void request('session', { session, enabled: false }).catch(() => {}); }
    });
    return () => {
      disposed = true; abort.abort(); clearInterval(expiry);
      controllerRef.current?.editing.endAll('connection_disabled');
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
  return { enabled, setEnabled, reconnect: () => setAttempt(value => value + 1), status: enabled ? status : 'off' as const,activities,tasks:visibleTasks,taskError,taskAction,targetLocked };
}
