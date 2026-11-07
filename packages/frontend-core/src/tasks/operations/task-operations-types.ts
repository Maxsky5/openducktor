import type { TaskControlContextValue } from "../../app-state/app-state-contexts";
import type { AgentSessionReadPort } from "../../queries/agent-sessions";
import type { ActiveWorkspace } from "../../types/session-slices";
import type { TasksStateContextValue } from "../../types/state-slices";

export type UseTaskOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  agentSessionReadPort?: AgentSessionReadPort;
};

export type UseTaskOperationsResult = TasksStateContextValue & TaskControlContextValue;
