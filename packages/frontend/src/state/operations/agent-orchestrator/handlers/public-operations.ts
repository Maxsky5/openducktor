import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentModelSelection,
  AgentSessionHistoryMessage,
  AgentSessionRef,
  AgentSessionTodoItem,
  AgentUserMessagePart,
  LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { StartAgentSession } from "@/types/agent-session-start";
import type { AgentOperationsContextValue } from "@/types/state-slices";

type SessionActions = {
  startAgentSession: StartAgentSession;
  sendAgentMessage: (session: AgentSessionIdentity, parts: AgentUserMessagePart[]) => Promise<void>;
  stopAgentSession: (session: AgentSessionIdentity) => Promise<void>;
  updateAgentSessionModel: (
    session: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ) => void;
  replyAgentApproval: (
    session: AgentSessionIdentity,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (
    session: AgentSessionIdentity,
    requestId: string,
    answers: string[][],
  ) => Promise<void>;
};

type CreatePublicOperationsArgs = {
  agentEngine: Pick<AgentEnginePort, "loadSessionTodos" | "loadSessionHistory">;
  sessionActions: SessionActions;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>;
};

const withErrorToast = async <T>(title: string, operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    toast.error(title, {
      description: errorMessage(error),
    });
    throw error;
  }
};

export const createOrchestratorPublicOperations = ({
  agentEngine,
  sessionActions,
  loadAgentSessionHistory,
}: CreatePublicOperationsArgs): AgentOperationsContextValue => ({
  readSessionTodos: (session: AgentSessionRef): Promise<AgentSessionTodoItem[]> =>
    agentEngine.loadSessionTodos(session),
  readSessionHistory: (
    session: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> => agentEngine.loadSessionHistory(session),
  loadAgentSessionHistory,
  startAgentSession: sessionActions.startAgentSession,
  sendAgentMessage: (session, parts: AgentUserMessagePart[]): Promise<void> =>
    withErrorToast("Failed to send message", () => sessionActions.sendAgentMessage(session, parts)),
  stopAgentSession: (session): Promise<void> =>
    withErrorToast("Failed to stop agent session", () => sessionActions.stopAgentSession(session)),
  updateAgentSessionModel: sessionActions.updateAgentSessionModel,
  replyAgentApproval: sessionActions.replyAgentApproval,
  answerAgentQuestion: sessionActions.answerAgentQuestion,
});
