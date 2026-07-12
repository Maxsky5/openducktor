import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { TaskExecutionDocument } from "@/components/features/agents";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { buildRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import { isQaRejectedTask } from "@/lib/task-qa";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  type AgentStudioQuickActionOption,
  buildAgentStudioQuickActions,
  selectPrimaryAgentStudioQuickAction,
} from "./agent-studio-quick-actions";
import {
  type AgentSessionWorkflowSummary,
  buildLatestSessionByRoleMap,
  buildLiveSessionByRoleMap,
  buildRoleEnabledMapForTask,
  buildSessionCreateOptions,
  buildSessionSelectorGroups,
  buildWorkflowStateByRole,
} from "./agents-page-session-tabs";

export type AgentStudioDocumentsContext = {
  specDoc: TaskDocumentState;
  planDoc: TaskDocumentState;
  qaDoc: TaskDocumentState;
};

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
  hasActiveGitConflict: boolean;
  roleLabelByRole: Record<AgentRole, string>;
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
  hasActiveGitConflict,
  roleLabelByRole,
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
      session.role !== null &&
        roleWorkflowsByTask[session.role].available &&
        session.activityState !== "waiting_input",
    ]),
  );
  const fallbackSessionForSelectedRole = workflowSessionByRole[role];
  const sessionSelectorValue = selectedSessionIdentity
    ? agentSessionIdentityKey(selectedSessionIdentity)
    : fallbackSessionForSelectedRole
      ? agentSessionIdentityKey(fallbackSessionForSelectedRole)
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
    hasActiveGitConflict,
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
    selectedRoleAvailable,
    selectedRoleReadOnlyReason,
    createSessionDisabled,
  };
};

type BuildActiveDocumentForRoleArgs = {
  activeRole: AgentRole;
  specDoc: TaskDocumentState;
  planDoc: TaskDocumentState;
  qaDoc: TaskDocumentState;
};

export const buildActiveDocumentForRole = ({
  activeRole,
  specDoc,
  planDoc,
  qaDoc,
}: BuildActiveDocumentForRoleArgs): TaskExecutionDocument | null => {
  if (activeRole === "spec") {
    return {
      title: "Specification",
      description: "Current spec document for this task.",
      emptyState: "No spec document yet.",
      document: specDoc,
    };
  }

  if (activeRole === "planner") {
    return {
      title: "Implementation Plan",
      description: "Current implementation plan for this task.",
      emptyState: "No implementation plan yet.",
      document: planDoc,
    };
  }

  if (activeRole === "qa") {
    return {
      title: "QA Report",
      description: "Latest QA report for this task.",
      emptyState: "No QA report yet.",
      document: qaDoc,
    };
  }

  return null;
};
