import {
  getSessionLaunchAction,
  isRoleAvailableForTask,
  type BuiltinLaunchActionId as SessionLaunchActionId,
  type BuiltinRoleId as AgentRole,
  type BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";

type AgentStudioSessionStartRoleInput = {
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskReady: boolean;
};

type AgentStudioKickoffAvailabilityInput = {
  launchActionId: SessionLaunchActionId;
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

export const canUseAgentStudioKickoffPrompt = ({
  launchActionId,
  canStartSession,
}: AgentStudioKickoffAvailabilityInput): boolean => {
  const selectedLaunchAction = getSessionLaunchAction(launchActionId);
  return canStartSession && selectedLaunchAction.template.kind === "kickoff";
};
