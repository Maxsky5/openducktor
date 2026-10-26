import type { RepositoryGitProviderContext, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { buildRoleWorkflowMapForTask } from "@openducktor/frontend-core/lib/task-agent-workflows";
import { isQaRejectedTask } from "@openducktor/frontend-core/lib/task-qa";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  type AgentStudioQuickActionOption,
  buildAgentStudioQuickActions,
  buildGitConflictQuickAction,
  buildRoleEnabledMapForTask,
  selectPrimaryAgentStudioQuickAction,
} from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import {
  type AgentSessionWorkflowSummary,
  buildLatestSessionByRoleMap,
  buildLiveSessionByRoleMap,
  buildSessionCreateOptions,
  buildSessionSelectorGroups,
  buildWorkflowStateByRole,
} from "./agents-page-session-tabs";

export type AgentStudioSessionContextUsage = {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number;
} | null;

type BuildWorkflowModelContextArgs = {
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  selectedSessionIdentity: AgentSessionIdentity | null;
  role: AgentRole;
  isSessionWorking: boolean;
  roleLabelByRole: Record<AgentRole, string>;
  gitProviderContext?: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
};

const isTaskAwaitingHumanFeedback = (task: TaskCard | null): boolean => {
  return task?.status === "human_review";
};

export type WorkflowModelContext = {
  workflowSessionByRole: Record<AgentRole, AgentSessionWorkflowSummary | null>;
  workflowStateByRole: ReturnType<typeof buildWorkflowStateByRole>;
  sessionSelectorGroups: ComboboxGroup[];
  sessionSelectorAutofocusByValue: Record<string, boolean>;
  sessionSelectorValue: string;
  sessionCreateOptions: ReturnType<typeof buildSessionCreateOptions>;
  quickActions: AgentStudioQuickActionOption[];
  primaryQuickAction: AgentStudioQuickActionOption | null;
  /** Shown first while the git actions report an active conflict. */
  gitConflictQuickAction: AgentStudioQuickActionOption | null;
  selectedRoleAvailable: boolean;
  selectedRoleReadOnlyReason: string | null;
  createSessionDisabled: boolean;
};

export const buildWorkflowModelContext = ({
  selectedTask,
  sessionsForTask,
  selectedSessionIdentity,
  role,
  isSessionWorking,
  roleLabelByRole,
  gitProviderContext,
  gitProviderReadError = null,
}: BuildWorkflowModelContextArgs): WorkflowModelContext => {
  const roleEnabledByTask = buildRoleEnabledMapForTask(selectedTask);
  const roleWorkflowsByTask = buildRoleWorkflowMapForTask(selectedTask);
  const workflowSessionByRole = buildLatestSessionByRoleMap(sessionsForTask);
  const liveSessionByRole = buildLiveSessionByRoleMap(sessionsForTask);
  const workflowStateByRole = buildWorkflowStateByRole({
    task: selectedTask,
    roleWorkflowsByTask,
    liveSessionByRole,
  });
  const selectedRoleAvailable = roleWorkflowsByTask[role].available;
  const selectedRoleReadOnlyReason = selectedRoleAvailable
    ? null
    : `${roleLabelByRole[role]} is unavailable for this task right now.`;
  const sessionSelectorGroups = buildSessionSelectorGroups({
    sessionsForTask,
    roleLabelByRole,
  });
  const sessionSelectorAutofocusByValue = Object.fromEntries(
    sessionsForTask.map((session) => [
      agentSessionIdentityKey(session),
      roleWorkflowsByTask[session.role].available && session.activityState !== "waiting_input",
    ]),
  );
  const sessionSelectorValue = selectedSessionIdentity
    ? agentSessionIdentityKey(selectedSessionIdentity)
    : "";
  const createSessionDisabled = Boolean(selectedSessionIdentity && isSessionWorking);
  const sessionCreateOptions = buildSessionCreateOptions({
    roleEnabledByTask,
    hasQaRejection: isQaRejectedTask(selectedTask),
    hasHumanFeedback: isTaskAwaitingHumanFeedback(selectedTask),
    createSessionDisabled,
    roleLabelByRole,
  });
  const quickActions = buildAgentStudioQuickActions({
    selectedTask,
    sessionsForTask,
    roleEnabledByTask,
    createSessionDisabled,
    gitProviderContext,
    gitProviderReadError,
  });

  return {
    workflowSessionByRole,
    workflowStateByRole,
    sessionSelectorGroups,
    sessionSelectorAutofocusByValue,
    sessionSelectorValue,
    sessionCreateOptions,
    quickActions,
    primaryQuickAction: selectPrimaryAgentStudioQuickAction(quickActions),
    gitConflictQuickAction: buildGitConflictQuickAction({
      selectedTask,
      roleEnabledByTask,
      createSessionDisabled,
    }),
    selectedRoleAvailable,
    selectedRoleReadOnlyReason,
    createSessionDisabled,
  };
};
