import type { AgentRole } from "@openducktor/core";
import {
  type AgentStudioSessionRouteParam,
  isSameAgentStudioSessionRouteParam,
} from "../query-sync/agent-studio-navigation";

export type AgentStudioSelectionIntent = {
  taskId: string;
  session: AgentStudioSessionRouteParam | null;
  role: AgentRole;
};

export const isSelectionIntentResolved = (params: {
  selectionIntent: AgentStudioSelectionIntent;
  taskIdParam: string;
  sessionParam: AgentStudioSessionRouteParam | null;
  roleFromQuery: AgentRole;
}): boolean => {
  const { selectionIntent, taskIdParam, sessionParam, roleFromQuery } = params;
  if (selectionIntent.taskId !== taskIdParam || selectionIntent.role !== roleFromQuery) {
    return false;
  }

  return isSameAgentStudioSessionRouteParam(selectionIntent.session, sessionParam);
};
