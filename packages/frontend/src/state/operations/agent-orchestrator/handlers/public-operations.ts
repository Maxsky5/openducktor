import type { RuntimeApprovalReplyOutcome, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentUserMessagePart,
} from "@openducktor/core";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { SessionRepoReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentSessionLoadOptions } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { StartAgentSessionInput } from "./start-session";

type SessionActions = {
  startAgentSession: (input: StartAgentSessionInput) => Promise<string>;
  settleStartedAgentSession: (externalSessionId: string) => void;
  sendAgentMessage: (externalSessionId: string, parts: AgentUserMessagePart[]) => Promise<void>;
  stopAgentSession: (externalSessionId: string) => Promise<void>;
  updateAgentSessionModel: (
    externalSessionId: string,
    selection: AgentModelSelection | null,
  ) => void;
  replyAgentApproval: (
    externalSessionId: string,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (
    externalSessionId: string,
    requestId: string,
    answers: string[][],
  ) => Promise<void>;
};

type CreatePublicOperationsArgs = {
  loadSelectedSessionHistoryForView: (input: {
    externalSessionId: string;
    repoReadinessState: SessionRepoReadinessState;
  }) => Promise<void>;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
  readSessionHistory: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    externalSessionId: string,
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
  loadSelectedSessionHistoryForView,
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
  loadSelectedSessionHistoryForView: (input) =>
    withErrorToast("Failed to load selected session history", () =>
      loadSelectedSessionHistoryForView(input),
    ),
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions): Promise<void> =>
    withErrorToast("Failed to load agent sessions", () => loadAgentSessions(taskId, options)),
  readSessionModelCatalog,
  readSessionTodos,
  readSessionHistory,
  readSessionSlashCommands,
  readSessionFileSearch,
  ...(readSessionSkills ? { readSessionSkills } : {}),
  removeAgentSession,
  removeAgentSessions: (input) => removeAgentSessions(input),
  startAgentSession: (input: StartAgentSessionInput): Promise<string> =>
    sessionActions.startAgentSession(input),
  settleStartedAgentSession: sessionActions.settleStartedAgentSession,
  sendAgentMessage: (externalSessionId: string, parts: AgentUserMessagePart[]): Promise<void> =>
    withErrorToast("Failed to send message", () =>
      sessionActions.sendAgentMessage(externalSessionId, parts),
    ),
  stopAgentSession: (externalSessionId: string): Promise<void> =>
    withErrorToast("Failed to stop agent session", () =>
      sessionActions.stopAgentSession(externalSessionId),
    ),
  updateAgentSessionModel: sessionActions.updateAgentSessionModel,
  replyAgentApproval: sessionActions.replyAgentApproval,
  answerAgentQuestion: sessionActions.answerAgentQuestion,
});
