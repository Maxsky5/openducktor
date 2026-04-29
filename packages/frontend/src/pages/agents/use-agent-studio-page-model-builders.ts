import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { AgentChatModel, AgentStudioWorkspaceDocument } from "@/components/features/agents";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { buildRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import { isQaRejectedTask } from "@/lib/task-qa";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { SCENARIO_LABELS } from "./agents-page-constants";
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
  sessionsForTask: AgentSessionWorkflowSummary[];
  activeSession: Pick<AgentSessionState, "sessionId" | "role"> | null;
  role: AgentRole;
  isSessionWorking: boolean;
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
    scenarioLabels: SCENARIO_LABELS,
    roleLabelByRole,
  });
  const sessionSelectorAutofocusByValue = Object.fromEntries(
    sessionsForTask.map((session) => [
      session.sessionId,
      session.role !== null &&
        roleWorkflowsByTask[session.role].available &&
        session.pendingPermissions.length === 0 &&
        session.pendingQuestions.length === 0,
    ]),
  );
  const fallbackSessionForSelectedRole = latestSessionByRole[selectedInteractionRole];
  const sessionSelectorValue =
    activeSession?.sessionId ?? fallbackSessionForSelectedRole?.sessionId ?? "";
  const createSessionDisabled = Boolean(activeSession && isSessionWorking);
  const sessionCreateOptions = buildSessionCreateOptions({
    roleEnabledByTask,
    hasQaRejection: isQaRejectedTask(selectedTask),
    hasHumanFeedback: isTaskAwaitingHumanFeedback(selectedTask),
    createSessionDisabled,
    roleLabelByRole,
    scenarioLabels: SCENARIO_LABELS,
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

export const toChatContextUsage = (
  activeSessionContextUsage: AgentStudioSessionContextUsage,
): AgentChatModel["composer"]["contextUsage"] => {
  if (activeSessionContextUsage === null) {
    return null;
  }

  return {
    totalTokens: activeSessionContextUsage.totalTokens,
    contextWindow: activeSessionContextUsage.contextWindow,
    ...(typeof activeSessionContextUsage.outputLimit === "number"
      ? { outputLimit: activeSessionContextUsage.outputLimit }
      : {}),
  };
};
