import { createContext } from 'react';
import type { ConnectorHost } from '../lib/aiConnector';
import type { ProjectConnectorAccess } from '../lib/projectConnectorHost';
import type { useAIConnectorRuntime } from './useAIConnector';

export type ConnectorState = ReturnType<typeof useAIConnectorRuntime>;
export const ConnectorContext = createContext<{
  state: ConnectorState;
  register: (token: object, host: ConnectorHost, context: string, project?: ProjectConnectorAccess) => void;
  unregister: (token: object) => void;
} | null>(null);
