import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { AgentStudioWorkspaceDocument } from "@/components/features/agents";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { buildRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import { isQaRejectedTask } from "@/lib/task-qa";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentStudioQuickActionOption,
  buildAgentStudioQuickActions,
  selectPrimaryAgentStudioQuickAction,
} from "./agent-studio-quick-actions";
import {
  type AgentSessionWorkflowSummary,
  buildLatestSessionByRoleMap,
  buildRoleEnabledMapForTask,
  buildRoleSessionSummaryMap,
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
  activeSession: Pick<
    AgentSessionState,
    "externalSessionId" | "runtimeKind" | "workingDirectory" | "role"
  > | null;
  role: AgentRole;
  isSessionWorking: boolean;
  hasActiveGitConflict: boolean;
  roleLabelByRole: Record<AgentRole, string>;
};

const isTaskAwaitingHumanFeedback = (task: TaskCard | null): boolean => {
  return task?.status === "human_review";
};

export type WorkflowModelContext = {
  latestSessionByRole: ReturnType<typeof buildLatestSessionByRoleMap>;
  workflowSessionByRole: Record<AgentRole, AgentSessionWorkflowSummary | null>;
  workflowStateByRole: ReturnType<typeof buildWorkflowStateByRole>;
  sessionSelectorGroups: ComboboxGroup[];
  sessionSelectorAutofocusByValue: Record<string, boolean>;
  sessionSelectorValue: string;
  sessionCreateOptions: ReturnType<typeof buildSessionCreateOptions>;
  quickActions: AgentStudioQuickActionOption[];
  primaryQuickAction: AgentStudioQuickActionOption | null;
  selectedInteractionRole: AgentRole;
  selectedRoleAvailable: boolean;
  selectedRoleReadOnlyReason: string | null;
  createSessionDisabled: boolean;
};

export const buildWorkflowModelContext = ({
  selectedTask,
  sessionsForTask,
  activeSession,
  role,
  isSessionWorking,
  hasActiveGitConflict,
  roleLabelByRole,
}: BuildWorkflowModelContextArgs): WorkflowModelContext => {
  const roleEnabledByTask = buildRoleEnabledMapForTask(selectedTask);
  const roleWorkflowsByTask = buildRoleWorkflowMapForTask(selectedTask);
  const latestSessionByRole = buildLatestSessionByRoleMap(sessionsForTask);
  const roleSessionByRole = buildRoleSessionSummaryMap(sessionsForTask);
  const workflowStateByRole = buildWorkflowStateByRole({
    task: selectedTask,
    roleWorkflowsByTask,
    roleSessionByRole,
  });
  const selectedInteractionRole = activeSession?.role ?? role;
  const selectedRoleAvailable = roleWorkflowsByTask[selectedInteractionRole].available;
  const selectedRoleReadOnlyReason = selectedRoleAvailable
    ? null
    : `${roleLabelByRole[selectedInteractionRole]} is unavailable for this task right now.`;
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
  const fallbackSessionForSelectedRole = latestSessionByRole[selectedInteractionRole];
  const sessionSelectorValue = activeSession
    ? agentSessionIdentityKey(activeSession)
    : fallbackSessionForSelectedRole
      ? agentSessionIdentityKey(fallbackSessionForSelectedRole)
      : "";
  const createSessionDisabled = Boolean(activeSession && isSessionWorking);
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
    latestSessionByRole,
    workflowSessionByRole: {
      spec: roleSessionByRole.spec.workflowSession,
      planner: roleSessionByRole.planner.workflowSession,
      build: roleSessionByRole.build.workflowSession,
      qa: roleSessionByRole.qa.workflowSession,
    },
    workflowStateByRole,
    sessionSelectorGroups,
    sessionSelectorAutofocusByValue,
    sessionSelectorValue,
    sessionCreateOptions,
    quickActions,
    primaryQuickAction: selectPrimaryAgentStudioQuickAction(quickActions),
    selectedInteractionRole,
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
}: BuildActiveDocumentForRoleArgs): AgentStudioWorkspaceDocument | null => {
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
