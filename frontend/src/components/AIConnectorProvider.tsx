import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConnectorContext } from '../hooks/connectorContext';
import { useAIConnectorRuntime } from '../hooks/useAIConnector';
import type { ConnectorHost } from '../lib/aiConnector';
import type { ProjectConnectorAccess } from '../lib/projectConnectorHost';
import { AIEditingNotice } from './AIEditingNotice';
import { ContinuationProgress } from './ContinuationProgress';

/** The transport and task identities belong to the window, never to a keyed editor. */
export function AIConnectorProvider({ children }: { children: ReactNode }) {
  const binding = useRef<{ token: object; host: ConnectorHost; project?: ProjectConnectorAccess } | null>(null);
  const retainedProject = useRef<ProjectConnectorAccess | undefined>(undefined);
  const [context, setContext] = useState('');
  const [visibleProject, setVisibleProject] = useState<string | null>(null);
  const reportProject = useCallback((id: string) => setVisibleProject(id), []);
  const register = useCallback((token: object, host: ConnectorHost, next: string, project?: ProjectConnectorAccess) => {
    binding.current = { token, host, project };
    if (project) retainedProject.current = project;
    setContext(next);
  }, []);
  const unregister = useCallback((token: object) => {
    if (binding.current?.token === token) { binding.current = null; setContext(''); }
  }, []);
  const host: ConnectorHost = {
    acceptTagTransaction: async receipt => {
      if (!binding.current?.host.acceptTagTransaction) return false;
      return binding.current.host.acceptTagTransaction(receipt);
    },
    current: async () => {
      if (!binding.current) throw Error('no_editable_interview');
      const current=await binding.current.host.current();
      return current;
    },
    publish: async (...args) => {
      if (!binding.current) throw Error('interview_changed');
      return binding.current.host.publish(...args);
    },
    applyMarks: async (...args) => {
      if (!binding.current?.host.applyMarks) throw Error('interview_changed');
      return binding.current.host.applyMarks(...args);
    },
  };
  const project: ProjectConnectorAccess = {
    publishTagProject: async next => { await (binding.current?.project ?? retainedProject.current)?.publishTagProject?.(next); },
    project: () => (binding.current?.project ?? retainedProject.current)?.project() ?? null,
    active: () => binding.current?.project?.active() ?? { interview_id: '', recording_id: '', version_id: null, directory: null },
    onSaved: target => binding.current?.project?.onSaved?.(target),
  };
  const state = useAIConnectorRuntime(host, context, project);
  const globalError = state.taskActionError || (visibleProject === null || state.recoveryProjectIds.includes(visibleProject) ? state.recoveryWarning : '');
  return <ConnectorContext.Provider value={{ state, register, unregister, reportProject }}>
    {!context && <div className="ai-editing-global"><AIEditingNotice activities={state.activities.filter(task => task.state !== 'completed')} isCurrent={() => false} onDismiss={id => state.taskAction('dismiss_editing', id)} onEnd={id => state.taskAction('end_editing', id)}>
      {globalError && <ContinuationProgress embedded tasks={state.tasks} error={globalError} onAction={(operation,id)=>state.taskAction(operation,id,true)} onDismissError={state.dismissTaskError}/>}
    </AIEditingNotice></div>}
    {children}
  </ConnectorContext.Provider>;
}
