import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentModelSelection,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentUserMessagePart,
  LoadAgentSessionHistoryInput,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import type { ClientFeedback } from "../../../platform/client-feedback";
import { errorMessage } from "../../../lib/errors";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentMessageSendOptions,
  AgentMessageSendReceipt,
  AgentSessionContextLoadTarget,
  AgentSessionIdentity,
  AgentSessionState,
} from "../../../types/agent-orchestrator";
import type { AgentOperationsContextValue } from "../../../types/session-slices";

type SessionActions = {
  sendAgentMessage: (
    session: AgentSessionIdentity,
    parts: AgentUserMessagePart[],
    options?: AgentMessageSendOptions,
  ) => Promise<AgentMessageSendReceipt | null>;
  manageAgentMessageQueue: AgentOperationsContextValue["manageAgentMessageQueue"];
  stopAgentSession: (session: AgentSessionIdentity) => Promise<void>;
  continueInterruptedTurn: (session: AgentSessionIdentity) => Promise<void>;
  updateAgentSessionModel: (
    session: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ) => Promise<void>;
  replyAgentApproval: (
    session: AgentSessionIdentity,
    request: AgentApprovalRequest,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (
    session: AgentSessionIdentity,
    request: AgentQuestionRequest,
    answers: string[][],
  ) => Promise<void>;
};

type CreatePublicOperationsArgs = {
  agentEngine: Pick<
    AgentEnginePort,
    | "loadSessionTodos"
    | "loadSessionHistory"
    | "loadSessionToolPart"
    | "describeGeneratedImages"
    | "readGeneratedImage"
    | "beginGeneratedImageBatch"
    | "releaseGeneratedImageBatch"
  >;
  sessionActions: SessionActions;
  feedback: ClientFeedback;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>;
  loadAgentSessionContext: (session: AgentSessionContextLoadTarget) => Promise<void>;
};

const withErrorFeedback = async <T>(
  feedback: ClientFeedback,
  title: string,
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    feedback.show("error", title, {
      description: errorMessage(error),
    });
    throw error;
  }
};

export const createOrchestratorPublicOperations = ({
  agentEngine,
  sessionActions,
  feedback,
  loadAgentSessionHistory,
  loadAgentSessionContext,
}: CreatePublicOperationsArgs): AgentOperationsContextValue => ({
  describeGeneratedImages: (input) => agentEngine.describeGeneratedImages(input),
  beginGeneratedImageBatch: (input) => agentEngine.beginGeneratedImageBatch(input),
  releaseGeneratedImageBatch: (input) => agentEngine.releaseGeneratedImageBatch(input),
  readGeneratedImage: (input) => agentEngine.readGeneratedImage(input),
  readSessionTodos: (session: PolicyBoundSessionRef): Promise<AgentSessionTodoItem[]> =>
    agentEngine.loadSessionTodos(session),
  readSessionHistory: (
    session: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> => agentEngine.loadSessionHistory(session),
  readSessionToolPart: (input) => agentEngine.loadSessionToolPart(input),
  loadAgentSessionHistory,
  loadAgentSessionContext,
  sendAgentMessage: (
    session,
    parts: AgentUserMessagePart[],
    options?: AgentMessageSendOptions,
  ): Promise<AgentMessageSendReceipt | null> => {
    return sessionActions.sendAgentMessage(session, parts, options);
  },
  manageAgentMessageQueue: sessionActions.manageAgentMessageQueue,
  stopAgentSession: (session): Promise<void> =>
    withErrorFeedback(feedback, "Failed to stop agent session", () =>
      sessionActions.stopAgentSession(session),
    ),
  continueInterruptedTurn: sessionActions.continueInterruptedTurn,
  // The caller reports a failure, because a send waits for this update and shows its own error.
  updateAgentSessionModel: sessionActions.updateAgentSessionModel,
  replyAgentApproval: sessionActions.replyAgentApproval,
  answerAgentQuestion: sessionActions.answerAgentQuestion,
});
