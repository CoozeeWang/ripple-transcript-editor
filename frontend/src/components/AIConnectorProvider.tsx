import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConnectorContext } from '../hooks/connectorContext';
import { useAIConnectorRuntime } from '../hooks/useAIConnector';
import type { ConnectorHost } from '../lib/aiConnector';
import type { ProjectConnectorAccess } from '../lib/projectConnectorHost';
import { AIEditingNotice } from './AIEditingNotice';

/** The transport and task identities belong to the window, never to a keyed editor. */
export function AIConnectorProvider({ children }: { children: ReactNode }) {
  const binding = useRef<{ token: object; host: ConnectorHost; project?: ProjectConnectorAccess } | null>(null);
  const retainedProject = useRef<ProjectConnectorAccess | undefined>(undefined);
  const [context, setContext] = useState('');
  const register = useCallback((token: object, host: ConnectorHost, next: string, project?: ProjectConnectorAccess) => {
    binding.current = { token, host, project };
    if (project) retainedProject.current = project;
    setContext(next);
  }, []);
  const unregister = useCallback((token: object) => {
    if (binding.current?.token === token) { binding.current = null; setContext(''); }
  }, []);
  const host: ConnectorHost = {
    current: async () => {
      if (!binding.current) throw Error('no_editable_interview');
      return binding.current.host.current();
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
    project: () => (binding.current?.project ?? retainedProject.current)?.project() ?? null,
    active: () => binding.current?.project?.active() ?? { interview_id: '', recording_id: '', version_id: null, directory: null },
    onSaved: target => binding.current?.project?.onSaved?.(target),
  };
  const state = useAIConnectorRuntime(host, context, project);
  return <ConnectorContext.Provider value={{ state, register, unregister }}>
    {!context && <div className="ai-editing-global"><AIEditingNotice activities={state.activities} isCurrent={() => false} onDismiss={id => state.taskAction('dismiss_editing', id)} onEnd={id => state.taskAction('end_editing', id)}/></div>}
    {children}
  </ConnectorContext.Provider>;
}
