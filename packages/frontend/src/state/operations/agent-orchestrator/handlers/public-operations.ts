import type { RuntimeApprovalReplyOutcome, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentSessionHistoryMessage,
  AgentSessionRef,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentUserMessagePart,
  LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { StartAgentSessionInput } from "./start-session";

type SessionActions = {
  startAgentSession: (input: StartAgentSessionInput) => Promise<AgentSessionIdentity>;
  settleStartedAgentSession: (session: AgentSessionIdentity) => void;
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
  loadAgentSessions: (taskId: string) => Promise<void>;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<void>;
  agentEngine: Pick<
    AgentEnginePort,
    | "listAvailableModels"
    | "loadSessionTodos"
    | "loadSessionHistory"
    | "listAvailableSlashCommands"
    | "listAvailableSkills"
    | "searchFiles"
  >;
  removeAgentSession: (session: AgentSessionIdentity) => Promise<void>;
  removeAgentSessions: (input: { taskId: string; roles?: AgentRole[] }) => Promise<void>;
  sessionActions: SessionActions;
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
  loadAgentSessions,
  loadAgentSessionHistory,
  agentEngine,
  removeAgentSession,
  removeAgentSessions,
  sessionActions,
}: CreatePublicOperationsArgs): AgentOperationsContextValue => ({
  loadAgentSessions: (taskId: string): Promise<void> =>
    withErrorToast("Failed to load agent sessions", () => loadAgentSessions(taskId)),
  loadAgentSessionHistory: (session: AgentSessionIdentity): Promise<void> =>
    withErrorToast("Failed to load agent session history", async () => {
      await loadAgentSessionHistory(session);
    }),
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentModelCatalog> => agentEngine.listAvailableModels({ repoPath, runtimeKind }),
  readSessionTodos: (session: AgentSessionRef): Promise<AgentSessionTodoItem[]> =>
    agentEngine.loadSessionTodos(session),
  readSessionHistory: (
    session: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> => agentEngine.loadSessionHistory(session),
  readSessionSlashCommands: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentSlashCommandCatalog> =>
    agentEngine.listAvailableSlashCommands({ repoPath, runtimeKind }),
  readSessionSkills: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ): Promise<AgentSkillCatalog> =>
    agentEngine.listAvailableSkills({ repoPath, runtimeKind, workingDirectory }),
  readSessionFileSearch: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    query: string,
  ): Promise<AgentFileSearchResult[]> =>
    agentEngine.searchFiles({ repoPath, runtimeKind, workingDirectory, query }),
  removeAgentSession,
  removeAgentSessions: (input) => removeAgentSessions(input),
  startAgentSession: (input: StartAgentSessionInput): Promise<AgentSessionIdentity> =>
    sessionActions.startAgentSession(input),
  settleStartedAgentSession: sessionActions.settleStartedAgentSession,
  sendAgentMessage: (session, parts: AgentUserMessagePart[]): Promise<void> =>
    withErrorToast("Failed to send message", () => sessionActions.sendAgentMessage(session, parts)),
  stopAgentSession: (session): Promise<void> =>
    withErrorToast("Failed to stop agent session", () => sessionActions.stopAgentSession(session)),
  updateAgentSessionModel: sessionActions.updateAgentSessionModel,
  replyAgentApproval: sessionActions.replyAgentApproval,
  answerAgentQuestion: sessionActions.answerAgentQuestion,
});
