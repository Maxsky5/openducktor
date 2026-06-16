import type {
  RuntimeApprovalReplyOutcome,
  RuntimeDescriptor,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentRole, AgentSessionTodoItem } from "@openducktor/core";
import type { AgentStudioWorkspaceDocument } from "@/components/features/agents";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  getAgentSessionWaitingInputPlaceholder,
  hasAgentSessionPendingApprovals,
  hasAgentSessionPendingQuestions,
} from "@/lib/agent-session-waiting-input";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentStudioDocumentsContext,
  buildActiveDocumentForRole,
  buildWorkflowModelContext,
  type WorkflowModelContext,
} from "../use-agent-studio-page-model-builders";

const EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS: Record<string, number> = Object.freeze({});
const EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS: Record<string, number> = Object.freeze({});

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

type SelectedSessionRuntimeDataInput = {
  todos: AgentSessionTodoItem[];
  isLoadingModelCatalog: boolean;
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

export type SelectedSessionRuntimeContext = {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeReadiness: RepoRuntimeReadiness;
  sessionRuntimeDataError: string | null;
  sessionTodos: AgentSessionTodoItem[];
  isLoadingModelCatalog: boolean;
  transcriptState: AgentSessionTranscriptState;
};

export type SelectedSessionPendingInputContext = {
  waitingInputPlaceholder: string | null;
  pendingQuestions: SelectedSessionPendingQuestionsContext;
  approvals: SelectedSessionApprovalsContext;
  subagentPendingApprovalCountBySessionKey: Record<string, number>;
  subagentPendingQuestionCountBySessionKey: Record<string, number>;
};

export type AgentStudioSelectedSessionContext = {
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  activeSession: AgentSessionState | null;
  workflow: WorkflowModelContext;
  documents: SelectedSessionDocumentsContext;
  rightPanel: SelectedSessionRightPanelContext;
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
  activeSessionRuntimeData: SelectedSessionRuntimeDataInput;
  runtimeDefinitions: RuntimeDescriptor[];
  sessionRuntimeDataError: string | null;
  hasActiveGitConflict: boolean;
  transcriptState: AgentSessionTranscriptState;
  documents: AgentStudioDocumentsContext;
  runtimeReadiness: RepoRuntimeReadiness;
  sessionActions: {
    isSessionWorking: boolean;
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

const buildSubagentPendingInputCountBySessionKey = (
  sessions: AgentSessionSummary[],
  readPendingInputCount: (session: AgentSessionSummary) => number,
  emptyCounts: Record<string, number>,
): Record<string, number> => {
  const next: Record<string, number> = {};
  for (const session of sessions) {
    const count = readPendingInputCount(session);
    if (count > 0) {
      next[agentSessionIdentityKey(session)] = count;
    }
  }

  return Object.keys(next).length > 0 ? next : emptyCounts;
};

export const buildAgentStudioSelectedSessionContext = ({
  taskId,
  role,
  selectedTask,
  sessionsForTask,
  allSessionSummaries,
  activeSession,
  activeSessionRuntimeData,
  runtimeDefinitions,
  sessionRuntimeDataError,
  hasActiveGitConflict,
  transcriptState,
  documents,
  runtimeReadiness,
  sessionActions,
  approvals,
  roleLabelByRole,
}: AgentStudioSelectedSessionContextInput): AgentStudioSelectedSessionContext => {
  const workflowActiveSession = activeSession
    ? {
        externalSessionId: activeSession.externalSessionId,
        runtimeKind: activeSession.runtimeKind,
        workingDirectory: activeSession.workingDirectory,
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
  const hasPendingQuestions = activeSession
    ? hasAgentSessionPendingQuestions(activeSession)
    : false;
  const hasPendingApprovals = activeSession
    ? hasAgentSessionPendingApprovals(activeSession)
    : false;
  const waitingInputPlaceholder = activeSession
    ? getAgentSessionWaitingInputPlaceholder(activeSession)
    : null;

  return {
    taskId,
    role,
    selectedTask,
    sessionsForTask,
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
    runtime: {
      runtimeDefinitions,
      runtimeReadiness,
      sessionRuntimeDataError,
      sessionTodos: activeSessionRuntimeData.todos,
      isLoadingModelCatalog: activeSessionRuntimeData.isLoadingModelCatalog,
      transcriptState,
    },
    pendingInput: {
      waitingInputPlaceholder,
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
      subagentPendingApprovalCountBySessionKey: buildSubagentPendingInputCountBySessionKey(
        allSessionSummaries,
        (session) => session.pendingApprovalCount,
        EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS,
      ),
      subagentPendingQuestionCountBySessionKey: buildSubagentPendingInputCountBySessionKey(
        allSessionSummaries,
        (session) => session.pendingQuestionCount,
        EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS,
      ),
    },
  };
};

export type { AgentStudioDocumentsContext };
