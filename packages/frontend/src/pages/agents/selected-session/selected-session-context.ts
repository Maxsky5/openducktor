import type {
  RuntimeApprovalReplyOutcome,
  RuntimeDescriptor,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { AgentStudioWorkspaceDocument } from "@/components/features/agents";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type {
  SessionRepoReadinessState as AgentStudioReadinessState,
  AgentStudioSelectedSessionLifecycle,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentStudioDocumentsContext,
  type AgentStudioSessionContextUsage,
  buildActiveDocumentForRole,
  buildWorkflowModelContext,
  toChatContextUsage,
  type WorkflowModelContext,
} from "../use-agent-studio-page-model-builders";

const EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS: Record<string, number> = Object.freeze({});
const EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS: Record<string, number> = Object.freeze({});

type SelectedSessionRuntimeReadinessContext = {
  readinessState: AgentStudioReadinessState;
  isReady: boolean;
  isRuntimeStarting: boolean;
  blockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

type SelectedSessionComposerActiveSession =
  | (Pick<
      AgentSessionState,
      | "externalSessionId"
      | "selectedModel"
      | "isLoadingModelCatalog"
      | "pendingApprovals"
      | "pendingQuestions"
    > & {
      runtimeKind: RuntimeKind | null;
    })
  | null;

type SelectedSessionPendingQuestionsContext = {
  canSubmit: boolean;
  isSubmittingByRequestId: Record<string, boolean>;
  onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
};

type SelectedSessionApprovalsContext = {
  canReply: boolean;
  isSubmittingByRequestId: Record<string, boolean>;
  errorByRequestId: Record<string, string>;
  onReply: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
};

export type SelectedSessionDocumentsContext = {
  activeDocumentRole: AgentRole;
  activeDocument: AgentStudioWorkspaceDocument | null;
  hasDocumentPanel: boolean;
};

export type SelectedSessionRightPanelContext = {
  role: AgentRole;
  hasTaskContext: boolean;
  hasDocumentPanel: boolean;
  hasBuildToolsPanel: boolean;
};

export type SelectedSessionChatContext = {
  emptyState: NonNullable<AgentChatModel["thread"]["emptyState"]> | null;
  contextUsage: AgentChatModel["composer"]["contextUsage"];
  activeComposerSession: SelectedSessionComposerActiveSession;
  composerReadOnly: boolean;
  composerReadOnlyReason: string | null;
};

export type SelectedSessionRuntimeContext = {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeReadiness: SelectedSessionRuntimeReadinessContext;
  sessionRuntimeDataError: string | null;
  lifecycle: AgentStudioSelectedSessionLifecycle;
};

export type SelectedSessionPendingInputContext = {
  pendingQuestions: SelectedSessionPendingQuestionsContext;
  approvals: SelectedSessionApprovalsContext;
  subagentPendingApprovalsByExternalSessionId:
    | AgentSessionState["subagentPendingApprovalsByExternalSessionId"]
    | undefined;
  subagentPendingApprovalCountByExternalSessionId: Record<string, number>;
  subagentPendingQuestionsByExternalSessionId:
    | AgentSessionState["subagentPendingQuestionsByExternalSessionId"]
    | undefined;
  subagentPendingQuestionCountByExternalSessionId: Record<string, number>;
};

export type AgentStudioSelectedSessionContext = {
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  allSessionSummaries: AgentSessionSummary[];
  activeSession: AgentSessionState | null;
  workflow: WorkflowModelContext;
  documents: SelectedSessionDocumentsContext;
  rightPanel: SelectedSessionRightPanelContext;
  chat: SelectedSessionChatContext;
  runtime: SelectedSessionRuntimeContext;
  pendingInput: SelectedSessionPendingInputContext;
};

export type AgentStudioSelectedSessionContextInput = {
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  allSessionSummaries: AgentSessionSummary[];
  activeSession: AgentSessionState | null;
  runtimeDefinitions: RuntimeDescriptor[];
  sessionRuntimeDataError: string | null;
  hasActiveGitConflict: boolean;
  lifecycle: AgentStudioSelectedSessionLifecycle;
  activeSessionContextUsage: AgentStudioSessionContextUsage;
  documents: AgentStudioDocumentsContext;
  readiness: {
    agentStudioReadinessState: AgentStudioReadinessState;
    agentStudioReady: boolean;
    isRuntimeStarting: boolean;
    agentStudioBlockedReason: string | null;
    isLoadingChecks: boolean;
    refreshChecks: () => Promise<void>;
  };
  sessionActions: {
    isStarting: boolean;
    isSessionWorking: boolean;
    canKickoffNewSession: boolean;
    kickoffLabel: string;
    startLaunchKickoff: () => Promise<void>;
    onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
    isSubmittingQuestionByRequestId: Record<string, boolean>;
  };
  approvals: {
    isSubmittingApprovalByRequestId: Record<string, boolean>;
    approvalReplyErrorByRequestId: Record<string, string>;
    onReplyApproval: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
  };
  roleLabelByRole: Record<AgentRole, string>;
};

const arePendingInputCountMapsEqual = (
  left: Record<string, number>,
  right: Record<string, number>,
): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left[key] === right[key]);
};

export const keepStablePendingInputCounts = (
  previous: Record<string, number>,
  next: Record<string, number>,
): Record<string, number> => {
  if (arePendingInputCountMapsEqual(previous, next)) {
    return previous;
  }

  return next;
};

const buildSubagentPendingApprovalCountByExternalSessionId = (
  sessions: AgentSessionSummary[],
  subagentPendingApprovalsByExternalSessionId:
    | AgentSessionState["subagentPendingApprovalsByExternalSessionId"]
    | undefined,
): Record<string, number> => {
  const next: Record<string, number> = {};
  for (const session of sessions) {
    const pendingApprovalCount = session.pendingApprovals.length;
    if (pendingApprovalCount > 0) {
      next[session.externalSessionId] = pendingApprovalCount;
    }
  }

  if (subagentPendingApprovalsByExternalSessionId) {
    for (const [externalSessionId, pendingApprovals] of Object.entries(
      subagentPendingApprovalsByExternalSessionId,
    )) {
      const pendingApprovalCount = pendingApprovals.length;
      if (pendingApprovalCount > 0) {
        next[externalSessionId] = pendingApprovalCount;
      }
    }
  }

  return Object.keys(next).length > 0 ? next : EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS;
};

const buildSubagentPendingQuestionCountByExternalSessionId = (
  sessions: AgentSessionSummary[],
  subagentPendingQuestionsByExternalSessionId:
    | AgentSessionState["subagentPendingQuestionsByExternalSessionId"]
    | undefined,
): Record<string, number> => {
  const next: Record<string, number> = {};
  for (const session of sessions) {
    const pendingQuestionCount = session.pendingQuestions.length;
    if (pendingQuestionCount > 0) {
      next[session.externalSessionId] = pendingQuestionCount;
    }
  }

  if (subagentPendingQuestionsByExternalSessionId) {
    for (const [externalSessionId, pendingQuestions] of Object.entries(
      subagentPendingQuestionsByExternalSessionId,
    )) {
      const pendingQuestionCount = pendingQuestions.length;
      if (pendingQuestionCount > 0) {
        next[externalSessionId] = pendingQuestionCount;
      }
    }
  }

  return Object.keys(next).length > 0 ? next : EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS;
};

export const buildAgentStudioSelectedSessionContext = ({
  taskId,
  role,
  selectedTask,
  sessionsForTask,
  allSessionSummaries,
  activeSession,
  runtimeDefinitions,
  sessionRuntimeDataError,
  hasActiveGitConflict,
  lifecycle,
  activeSessionContextUsage,
  documents,
  readiness,
  sessionActions,
  approvals,
  roleLabelByRole,
}: AgentStudioSelectedSessionContextInput): AgentStudioSelectedSessionContext => {
  const workflowActiveSession = activeSession
    ? {
        externalSessionId: activeSession.externalSessionId,
        role: activeSession.role,
      }
    : null;
  const workflow = buildWorkflowModelContext({
    selectedTask,
    sessionsForTask,
    activeSession: workflowActiveSession,
    role,
    isSessionWorking: sessionActions.isSessionWorking,
    hasActiveGitConflict,
    roleLabelByRole,
  });
  const activeDocumentRole = activeSession?.role ?? role;
  const activeDocument = taskId
    ? buildActiveDocumentForRole({
        activeRole: activeDocumentRole,
        specDoc: documents.specDoc,
        planDoc: documents.planDoc,
        qaDoc: documents.qaDoc,
      })
    : null;
  const canKickoff = sessionActions.canKickoffNewSession && workflow.selectedRoleAvailable;
  const composerReadOnly = !activeSession && !workflow.selectedRoleAvailable;
  const emptyState = buildSelectedSessionChatEmptyState({
    taskId,
    isStarting: sessionActions.isStarting,
    canKickoff,
    kickoffLabel: sessionActions.kickoffLabel,
    startLaunchKickoff: sessionActions.startLaunchKickoff,
  });
  const hasPendingQuestions = (activeSession?.pendingQuestions ?? []).length > 0;
  const hasPendingApprovals = (activeSession?.pendingApprovals ?? []).length > 0;

  return {
    taskId,
    role,
    selectedTask,
    sessionsForTask,
    allSessionSummaries,
    activeSession,
    workflow,
    documents: {
      activeDocumentRole,
      activeDocument,
      hasDocumentPanel: Boolean(activeDocument),
    },
    rightPanel: {
      role,
      hasTaskContext: Boolean(taskId),
      hasDocumentPanel: Boolean(activeDocument),
      hasBuildToolsPanel: role === "build",
    },
    chat: {
      emptyState,
      contextUsage: toChatContextUsage(activeSessionContextUsage),
      activeComposerSession: activeSession
        ? {
            externalSessionId: activeSession.externalSessionId,
            runtimeKind: activeSession.runtimeKind ?? null,
            selectedModel: activeSession.selectedModel,
            isLoadingModelCatalog: activeSession.isLoadingModelCatalog,
            pendingApprovals: activeSession.pendingApprovals,
            pendingQuestions: activeSession.pendingQuestions,
          }
        : null,
      composerReadOnly,
      composerReadOnlyReason: composerReadOnly ? workflow.selectedRoleReadOnlyReason : null,
    },
    runtime: {
      runtimeDefinitions,
      runtimeReadiness: {
        readinessState: readiness.agentStudioReadinessState,
        isReady: readiness.agentStudioReady,
        isRuntimeStarting: readiness.isRuntimeStarting,
        blockedReason: readiness.agentStudioBlockedReason,
        isLoadingChecks: readiness.isLoadingChecks,
        refreshChecks: readiness.refreshChecks,
      },
      sessionRuntimeDataError,
      lifecycle,
    },
    pendingInput: {
      pendingQuestions: {
        canSubmit: hasPendingQuestions,
        isSubmittingByRequestId: sessionActions.isSubmittingQuestionByRequestId,
        onSubmit: sessionActions.onSubmitQuestionAnswers,
      },
      approvals: {
        canReply: hasPendingApprovals,
        isSubmittingByRequestId: approvals.isSubmittingApprovalByRequestId,
        errorByRequestId: approvals.approvalReplyErrorByRequestId,
        onReply: approvals.onReplyApproval,
      },
      subagentPendingApprovalsByExternalSessionId:
        activeSession?.subagentPendingApprovalsByExternalSessionId,
      subagentPendingApprovalCountByExternalSessionId:
        buildSubagentPendingApprovalCountByExternalSessionId(
          allSessionSummaries,
          activeSession?.subagentPendingApprovalsByExternalSessionId,
        ),
      subagentPendingQuestionsByExternalSessionId:
        activeSession?.subagentPendingQuestionsByExternalSessionId,
      subagentPendingQuestionCountByExternalSessionId:
        buildSubagentPendingQuestionCountByExternalSessionId(
          allSessionSummaries,
          activeSession?.subagentPendingQuestionsByExternalSessionId,
        ),
    },
  };
};

const buildSelectedSessionChatEmptyState = ({
  taskId,
  isStarting,
  canKickoff,
  kickoffLabel,
  startLaunchKickoff,
}: {
  taskId: string;
  isStarting: boolean;
  canKickoff: boolean;
  kickoffLabel: string;
  startLaunchKickoff: () => Promise<void>;
}): NonNullable<AgentChatModel["thread"]["emptyState"]> | null => {
  if (!taskId) {
    return {
      title: "Select a task to begin.",
    };
  }

  if (isStarting) {
    return {
      title: "Initializing session...",
    };
  }

  if (canKickoff) {
    return {
      title: "Send a message to start a new session automatically.",
      actionLabel: kickoffLabel,
      onAction: (): void => {
        void startLaunchKickoff();
      },
    };
  }

  return {
    title: "Send a message to start a new session automatically.",
  };
};

export type { AgentStudioDocumentsContext };
