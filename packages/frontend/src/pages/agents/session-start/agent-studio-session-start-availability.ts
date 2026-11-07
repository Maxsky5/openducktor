import {
  isRoleAvailableForTask,
  type WorkflowLaunchActionId as SessionLaunchActionId,
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";

type AgentStudioSessionStartRoleInput = {
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskReady: boolean;
};

type AgentStudioKickoffAvailabilityInput = {
  launchActionId: SessionLaunchActionId | null;
  canStartSession: boolean;
  selectedTask: TaskCard | null;
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
  selectedTask,
}: AgentStudioKickoffAvailabilityInput): boolean => {
  if (!selectedTask || !launchActionId) return false;
  const selectedLaunchAction = selectedTask.taskWorkflow.launchDefinition(launchActionId);
  return canStartSession && selectedLaunchAction.template.kind === "kickoff";
};
