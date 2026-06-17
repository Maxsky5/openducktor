import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { getSessionLaunchAction, type SessionLaunchActionId } from "@/features/session-start";
import { isRoleAvailableForTask } from "@/lib/task-agent-workflows";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

type AgentStudioSessionStartRoleInput = {
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskReady: boolean;
};

type AgentStudioKickoffAvailabilityInput = {
  launchActionId: SessionLaunchActionId;
  selectedSessionIdentity: AgentSessionIdentity | null;
  canStartSession: boolean;
};

export const canStartAgentStudioSessionRole = ({
  taskId,
  role,
  selectedTask,
  agentStudioReady,
  isActiveTaskReady,
}: AgentStudioSessionStartRoleInput): boolean => {
  return (
    Boolean(taskId) &&
    agentStudioReady &&
    isActiveTaskReady &&
    isRoleAvailableForTask(selectedTask, role)
  );
};

export const canExposeAgentStudioKickoff = ({
  launchActionId,
  selectedSessionIdentity,
  canStartSession,
}: AgentStudioKickoffAvailabilityInput): boolean => {
  const selectedLaunchAction = getSessionLaunchAction(launchActionId);
  return (
    canStartSession &&
    selectedSessionIdentity === null &&
    Boolean(selectedLaunchAction.kickoffTemplateId)
  );
};
