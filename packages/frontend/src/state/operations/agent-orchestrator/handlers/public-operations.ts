import type { RuntimeApprovalReplyOutcome, RuntimeKind } from "@openducktor/contracts";
import type {
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
import type {
  AgentSessionIdentity,
  AgentSessionRouteIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue, LoadAgentSessionsOptions } from "@/types/state-slices";
import type { StartAgentSessionInput } from "./start-session";

type SessionActions = {
  startAgentSession: (input: StartAgentSessionInput) => Promise<AgentSessionRouteIdentity>;
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
  loadAgentSessionHistory: (input: { session: AgentSessionState }) => Promise<void>;
  loadAgentSessions: (taskId: string, options?: LoadAgentSessionsOptions) => Promise<void>;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (session: AgentSessionRef) => Promise<AgentSessionTodoItem[]>;
  readSessionHistory: (
    session: LoadAgentSessionHistoryInput,
  ) => Promise<AgentSessionHistoryMessage[]>;
  readSessionSlashCommands: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>;
  readSessionSkills?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>;
  readSessionFileSearch: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
  removeAgentSession: (externalSessionId: string) => Promise<void>;
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
  loadAgentSessionHistory,
  loadAgentSessions,
  readSessionModelCatalog,
  readSessionTodos,
  readSessionHistory,
  readSessionSlashCommands,
  readSessionFileSearch,
  readSessionSkills,
  removeAgentSession,
  removeAgentSessions,
  sessionActions,
}: CreatePublicOperationsArgs): AgentOperationsContextValue => ({
  loadAgentSessionHistory: (input) =>
    withErrorToast("Failed to load agent session history", () => loadAgentSessionHistory(input)),
  loadAgentSessions: (taskId: string, options?: LoadAgentSessionsOptions): Promise<void> =>
    withErrorToast("Failed to load agent sessions", () => loadAgentSessions(taskId, options)),
  readSessionModelCatalog,
  readSessionTodos,
  readSessionHistory,
  readSessionSlashCommands,
  readSessionFileSearch,
  ...(readSessionSkills ? { readSessionSkills } : {}),
  removeAgentSession,
  removeAgentSessions: (input) => removeAgentSessions(input),
  startAgentSession: (input: StartAgentSessionInput): Promise<AgentSessionRouteIdentity> =>
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
