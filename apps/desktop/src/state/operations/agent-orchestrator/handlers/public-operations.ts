import type {
  AgentSessionRecord,
  RunSummary,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRuntimeConnection,
  AgentSessionTodoItem,
  AgentSlashCommandCatalog,
  AgentUserMessagePart,
  LiveAgentSessionSnapshot,
} from "@openducktor/core";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { StartAgentSessionInput } from "./start-session";

type SessionActions = {
  startAgentSession: (input: StartAgentSessionInput) => Promise<string>;
  sendAgentMessage: (sessionId: string, parts: AgentUserMessagePart[]) => Promise<void>;
  stopAgentSession: (sessionId: string) => Promise<void>;
  updateAgentSessionModel: (sessionId: string, selection: AgentModelSelection | null) => void;
  replyAgentPermission: (
    sessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (sessionId: string, requestId: string, answers: string[][]) => Promise<void>;
};

type CreatePublicOperationsArgs = {
  bootstrapTaskSessions: (taskId: string, persistedRecords?: AgentSessionRecord[]) => Promise<void>;
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    sessionId: string;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
  retrySessionRuntimeAttachment: (input: {
    taskId: string;
    sessionId: string;
    recoveryDedupKey?: string | null;
    persistedRecords?: AgentSessionRecord[];
    preloadedRuns?: RunSummary[];
  }) => Promise<boolean>;
  reconcileLiveTaskSessions: (input: {
    taskId: string;
    persistedRecords?: AgentSessionRecord[];
    preloadedRuns?: RunSummary[];
    preloadedRuntimeLists?: Map<RuntimeKind, RuntimeInstanceSummary[]>;
    preloadedRuntimeConnectionsByKey?: Map<string, AgentRuntimeConnection>;
    preloadedLiveAgentSessionsByKey?: Map<string, LiveAgentSessionSnapshot[]>;
    allowRuntimeEnsure?: boolean;
  }) => Promise<void>;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  readSessionModelCatalog: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
  readSessionSlashCommands: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentSlashCommandCatalog>;
  readSessionFileSearch: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
  removeAgentSessions: (input: { taskId: string; roles?: AgentSessionState["role"][] }) => void;
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
  retrySessionRuntimeAttachment,
  reconcileLiveTaskSessions,
  loadAgentSessions,
  readSessionModelCatalog,
  readSessionTodos,
  readSessionSlashCommands,
  readSessionFileSearch,
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
  retrySessionRuntimeAttachment: (input) =>
    withErrorToast("Failed to reconnect session runtime", () =>
      retrySessionRuntimeAttachment(input),
    ),
  reconcileLiveTaskSessions: (input) =>
    withErrorToast("Failed to reconcile live sessions", () => reconcileLiveTaskSessions(input)),
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions): Promise<void> =>
    withErrorToast("Failed to load agent sessions", () => loadAgentSessions(taskId, options)),
  readSessionModelCatalog,
  readSessionTodos,
  readSessionSlashCommands,
  readSessionFileSearch,
  removeAgentSessions,
  startAgentSession: (input: StartAgentSessionInput): Promise<string> =>
    sessionActions.startAgentSession(input),
  sendAgentMessage: (sessionId: string, parts: AgentUserMessagePart[]): Promise<void> =>
    withErrorToast("Failed to send message", () =>
      sessionActions.sendAgentMessage(sessionId, parts),
    ),
  stopAgentSession: (sessionId: string): Promise<void> =>
    withErrorToast("Failed to stop agent session", () =>
      sessionActions.stopAgentSession(sessionId),
    ),
  updateAgentSessionModel: sessionActions.updateAgentSessionModel,
  replyAgentPermission: sessionActions.replyAgentPermission,
  answerAgentQuestion: sessionActions.answerAgentQuestion,
});
