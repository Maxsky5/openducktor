import type {
  RuntimeApprovalReplyOutcome,
  RuntimeDescriptor,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
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
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { SelectedSessionRuntimeData } from "@/types/selected-session-runtime-data";
import {
  type AgentStudioDocumentsContext,
  buildActiveDocumentForRole,
  buildWorkflowModelContext,
  type WorkflowModelContext,
} from "../use-agent-studio-page-model-builders";

const EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS: Record<string, number> = Object.freeze({});
const EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS: Record<string, number> = Object.freeze({});
const EMPTY_PENDING_APPROVAL_REQUESTS = Object.freeze([]) as readonly AgentApprovalRequest[];
const EMPTY_PENDING_QUESTION_REQUESTS = Object.freeze([]) as readonly AgentQuestionRequest[];

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
  activeDocument: AgentStudioWorkspaceDocument | null;
};

export type SelectedSessionRuntimeContext = {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeReadiness: RepoRuntimeReadiness;
  runtimeData: SelectedSessionRuntimeData;
};

export type SelectedSessionPendingInputContext = {
  waitingInputPlaceholder: string | null;
  pendingApprovalRequests: readonly AgentApprovalRequest[];
  pendingQuestionRequests: readonly AgentQuestionRequest[];
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
  selectedSessionIdentity: AgentSessionIdentity | null;
  selectedSessionActivityState: AgentSessionActivityState | null;
  selectedSessionModel: AgentSessionState["selectedModel"];
  loadedSession: AgentSessionState | null;
  transcriptState: AgentSessionTranscriptState;
  workflow: WorkflowModelContext;
  documents: SelectedSessionDocumentsContext;
  runtime: SelectedSessionRuntimeContext;
  pendingInput: SelectedSessionPendingInputContext;
};

export type AgentStudioSelectedSessionContextInput = {
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  allSessionSummaries: AgentSessionSummary[];
  selectedSessionIdentity: AgentSessionIdentity | null;
  selectedSessionActivityState: AgentSessionActivityState | null;
  selectedSessionModel: AgentSessionState["selectedModel"];
  loadedSession: AgentSessionState | null;
  sessionRuntimeData: SelectedSessionRuntimeData;
  runtimeDefinitions: RuntimeDescriptor[];
  hasActiveGitConflict: boolean;
  transcriptState: AgentSessionTranscriptState;
  documents: AgentStudioDocumentsContext;
  runtimeReadiness: RepoRuntimeReadiness;
  sessionActions: {
    isSessionWorking: boolean;
    onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
    isSubmittingQuestionByRequestId: Record<string, boolean>;
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
  selectedSessionIdentity,
  selectedSessionActivityState,
  selectedSessionModel,
  loadedSession,
  sessionRuntimeData,
  runtimeDefinitions,
  hasActiveGitConflict,
  transcriptState,
  documents,
  runtimeReadiness,
  sessionActions,
  roleLabelByRole,
}: AgentStudioSelectedSessionContextInput): AgentStudioSelectedSessionContext => {
  const workflow = buildWorkflowModelContext({
    selectedTask,
    sessionsForTask,
    selectedSessionIdentity,
    role,
    isSessionWorking: sessionActions.isSessionWorking,
    hasActiveGitConflict,
    roleLabelByRole,
  });
  const activeDocument = taskId
    ? buildActiveDocumentForRole({
        activeRole: role,
        specDoc: documents.specDoc,
        planDoc: documents.planDoc,
        qaDoc: documents.qaDoc,
      })
    : null;
  const pendingApprovalRequests =
    loadedSession?.pendingApprovals ?? EMPTY_PENDING_APPROVAL_REQUESTS;
  const pendingQuestionRequests =
    loadedSession?.pendingQuestions ?? EMPTY_PENDING_QUESTION_REQUESTS;
  const hasPendingQuestions = hasAgentSessionPendingQuestions({
    pendingQuestions: pendingQuestionRequests,
  });
  const hasPendingApprovals = hasAgentSessionPendingApprovals({
    pendingApprovals: pendingApprovalRequests,
  });
  const waitingInputPlaceholder = getAgentSessionWaitingInputPlaceholder({
    pendingApprovals: pendingApprovalRequests,
    pendingQuestions: pendingQuestionRequests,
  });

  return {
    taskId,
    role,
    selectedTask,
    sessionsForTask,
    selectedSessionIdentity,
    selectedSessionActivityState,
    selectedSessionModel,
    loadedSession,
    transcriptState,
    workflow,
    documents: {
      activeDocument,
    },
    runtime: {
      runtimeDefinitions,
      runtimeReadiness,
      runtimeData: sessionRuntimeData,
    },
    pendingInput: {
      waitingInputPlaceholder,
      pendingApprovalRequests,
      pendingQuestionRequests,
      pendingQuestions: {
        canSubmit: hasPendingQuestions,
        isSubmittingByRequestId: sessionActions.isSubmittingQuestionByRequestId,
        onSubmit: sessionActions.onSubmitQuestionAnswers,
      },
      approvals: {
        canReply: hasPendingApprovals,
        isSubmittingByRequestId: sessionActions.isSubmittingApprovalByRequestId,
        errorByRequestId: sessionActions.approvalReplyErrorByRequestId,
        onReply: sessionActions.onReplyApproval,
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
