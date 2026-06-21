import type { RuntimeApprovalReplyOutcome, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { AgentStudioWorkspaceDocument } from "@/components/features/agents";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  getAgentSessionWaitingInputPlaceholder,
  hasAgentSessionPendingApprovals,
  hasAgentSessionPendingQuestions,
} from "@/lib/agent-session-waiting-input";
import { resolveAgentPendingInputParticipants } from "@/state/agent-session-pending-input-participants";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "@/types/agent-orchestrator";
import {
  type AgentStudioDocumentsContext,
  buildActiveDocumentForRole,
  buildWorkflowModelContext,
  type WorkflowModelContext,
} from "../use-agent-studio-page-model-builders";
import type { AgentStudioSelectedSessionState } from "./selected-session-state";

const EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS: Record<string, number> = Object.freeze({});
const EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS: Record<string, number> = Object.freeze({});
const EMPTY_PENDING_APPROVAL_REQUESTS = Object.freeze([]) as readonly AgentApprovalRequest[];
const EMPTY_PENDING_QUESTION_REQUESTS = Object.freeze([]) as readonly AgentQuestionRequest[];
type PendingInputRequest = AgentApprovalRequest | AgentQuestionRequest;

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
  selectedSession: AgentStudioSelectedSessionState;
  workflow: WorkflowModelContext;
  documents: SelectedSessionDocumentsContext;
  pendingInput: SelectedSessionPendingInputContext;
};

export type AgentStudioSelectedSessionContextInput = {
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  allSessionSummaries: AgentSessionSummary[];
  selectedSession: AgentStudioSelectedSessionState;
  hasActiveGitConflict: boolean;
  documents: AgentStudioDocumentsContext;
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

const resolvePendingInputChildSession = (
  selectedSessionIdentity: AgentSessionIdentity | null,
  request: PendingInputRequest,
): AgentSessionIdentity | null => {
  if (request.source?.kind !== "subagent") {
    return null;
  }
  if (request.responseSession) {
    return request.responseSession;
  }
  if (!selectedSessionIdentity) {
    return null;
  }

  return resolveAgentPendingInputParticipants(selectedSessionIdentity, request)
    .subagentChildSession;
};

const buildSubagentPendingInputCountBySessionKey = (
  sessions: AgentSessionSummary[],
  readPendingInputCount: (session: AgentSessionSummary) => number,
  selectedSessionIdentity: AgentSessionIdentity | null,
  pendingRequests: readonly PendingInputRequest[],
  emptyCounts: Record<string, number>,
): Record<string, number> => {
  const next: Record<string, number> = {};
  const setMaxCount = (key: string, count: number): void => {
    next[key] = Math.max(next[key] ?? 0, count);
  };

  for (const session of sessions) {
    const count = readPendingInputCount(session);
    if (count > 0) {
      setMaxCount(agentSessionIdentityKey(session), count);
    }
  }

  const projectedCountsBySessionKey = new Map<string, number>();
  for (const request of pendingRequests) {
    const responseSession = resolvePendingInputChildSession(selectedSessionIdentity, request);
    if (!responseSession) {
      continue;
    }
    const sessionKey = agentSessionIdentityKey(responseSession);
    const count = projectedCountsBySessionKey.get(sessionKey) ?? 0;
    projectedCountsBySessionKey.set(sessionKey, count + 1);
  }
  for (const [sessionKey, count] of projectedCountsBySessionKey) {
    setMaxCount(sessionKey, count);
  }

  return Object.keys(next).length > 0 ? next : emptyCounts;
};

export const buildAgentStudioSelectedSessionContext = ({
  taskId,
  role,
  selectedTask,
  sessionsForTask,
  allSessionSummaries,
  selectedSession,
  hasActiveGitConflict,
  documents,
  sessionActions,
  roleLabelByRole,
}: AgentStudioSelectedSessionContextInput): AgentStudioSelectedSessionContext => {
  const { identity: selectedSessionIdentity, loadedSession } = selectedSession;
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
    selectedSession,
    workflow,
    documents: {
      activeDocument,
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
        selectedSessionIdentity,
        pendingApprovalRequests,
        EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS,
      ),
      subagentPendingQuestionCountBySessionKey: buildSubagentPendingInputCountBySessionKey(
        allSessionSummaries,
        (session) => session.pendingQuestionCount,
        selectedSessionIdentity,
        pendingQuestionRequests,
        EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS,
      ),
    },
  };
};

export type { AgentStudioDocumentsContext };
