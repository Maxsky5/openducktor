import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentSlashCommandCatalog,
  AgentUserMessagePart,
  LiveAgentSessionSnapshot,
} from "@openducktor/core";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { SessionRepoReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type {
  AgentSessionHistoryPreludeMode,
  AgentSessionLoadOptions,
} from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { StartAgentSessionInput } from "./start-session";

type SessionActions = {
  startAgentSession: (input: StartAgentSessionInput) => Promise<string>;
  sendAgentMessage: (externalSessionId: string, parts: AgentUserMessagePart[]) => Promise<void>;
  stopAgentSession: (externalSessionId: string) => Promise<void>;
  updateAgentSessionModel: (
    externalSessionId: string,
    selection: AgentModelSelection | null,
  ) => void;
  replyAgentPermission: (
    externalSessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (
    externalSessionId: string,
    requestId: string,
    answers: string[][],
  ) => Promise<void>;
};

type CreatePublicOperationsArgs = {
  bootstrapTaskSessions: (taskId: string, persistedRecords?: AgentSessionRecord[]) => Promise<void>;
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    externalSessionId: string;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: SessionRepoReadinessState;
    recoveryDedupKey?: string | null;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<boolean>;
  reconcileLiveTaskSessions: (input: {
    taskId: string;
    persistedRecords?: AgentSessionRecord[];
    preloadedRuntimeLists?: Map<RuntimeKind, RuntimeInstanceSummary[]>;
    preloadedLiveAgentSessionsByKey?: Map<string, LiveAgentSessionSnapshot[]>;
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
    runtimeId?: string | null,
  ) => Promise<AgentSessionTodoItem[]>;
  readSessionHistory: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    externalSessionId: string,
    runtimeId?: string | null,
  ) => Promise<AgentSessionHistoryMessage[]>;
  attachRuntimeTranscriptSession: AgentOperationsContextValue["attachRuntimeTranscriptSession"];
  readSessionSlashCommands: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>;
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

type OrchestratorPublicOperations = AgentOperationsContextValue;

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
  bootstrapTaskSessions,
  hydrateRequestedTaskSessionHistory,
  ensureSessionReadyForView,
  reconcileLiveTaskSessions,
  loadAgentSessions,
  readSessionModelCatalog,
  readSessionTodos,
  readSessionHistory,
  attachRuntimeTranscriptSession,
  readSessionSlashCommands,
  readSessionFileSearch,
  removeAgentSession,
  removeAgentSessions,
  sessionActions,
}: CreatePublicOperationsArgs): OrchestratorPublicOperations => ({
  bootstrapTaskSessions: (taskId, persistedRecords) =>
    withErrorToast("Failed to load agent sessions", () =>
      bootstrapTaskSessions(taskId, persistedRecords),
    ),
  hydrateRequestedTaskSessionHistory: (input) =>
    withErrorToast("Failed to hydrate session history", () =>
      hydrateRequestedTaskSessionHistory(input),
    ),
  ensureSessionReadyForView: (input) =>
    withErrorToast("Failed to prepare session", () => ensureSessionReadyForView(input)),
  reconcileLiveTaskSessions: (input) =>
    withErrorToast("Failed to reconcile live sessions", () => reconcileLiveTaskSessions(input)),
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions): Promise<void> =>
    withErrorToast("Failed to load agent sessions", () => loadAgentSessions(taskId, options)),
  readSessionModelCatalog,
  readSessionTodos,
  readSessionHistory,
  attachRuntimeTranscriptSession,
  readSessionSlashCommands,
  readSessionFileSearch,
  removeAgentSession,
  removeAgentSessions: (input) => removeAgentSessions(input),
  startAgentSession: (input: StartAgentSessionInput): Promise<string> =>
    sessionActions.startAgentSession(input),
  sendAgentMessage: (externalSessionId: string, parts: AgentUserMessagePart[]): Promise<void> =>
    withErrorToast("Failed to send message", () =>
      sessionActions.sendAgentMessage(externalSessionId, parts),
    ),
  stopAgentSession: (externalSessionId: string): Promise<void> =>
    withErrorToast("Failed to stop agent session", () =>
      sessionActions.stopAgentSession(externalSessionId),
    ),
  updateAgentSessionModel: sessionActions.updateAgentSessionModel,
  replyAgentPermission: sessionActions.replyAgentPermission,
  answerAgentQuestion: sessionActions.answerAgentQuestion,
});
