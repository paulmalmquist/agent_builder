import { createContext, useContext } from 'react';

export interface AgentDrawerContextValue {
  openAgent: (agentId: string) => void;
}

export const AgentDrawerContext = createContext<AgentDrawerContextValue | null>(null);

export function useAgentDrawer(): AgentDrawerContextValue {
  const value = useContext(AgentDrawerContext);
  if (!value) throw new Error('useAgentDrawer must be used inside PlatformShell.');
  return value;
}
