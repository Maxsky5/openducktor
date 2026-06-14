import type { AgentRole } from "@openducktor/core";

export type AgentStudioSelectionIntent = {
  taskId: string;
  externalSessionId: string | null;
  role: AgentRole;
};

export const isSelectionIntentResolved = (params: {
  selectionIntent: AgentStudioSelectionIntent;
  taskIdParam: string;
  sessionParam: string | null;
  roleFromQuery: AgentRole;
}): boolean => {
  const { selectionIntent, taskIdParam, sessionParam, roleFromQuery } = params;
  if (selectionIntent.taskId !== taskIdParam || selectionIntent.role !== roleFromQuery) {
    return false;
  }

  return selectionIntent.externalSessionId === sessionParam;
};
