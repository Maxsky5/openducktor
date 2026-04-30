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
  AgentRuntimeConnection,
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
  RuntimeConnectionPreloadIndex,
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
    preloadedRuntimeConnections?: RuntimeConnectionPreloadIndex;
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
  readSessionHistory: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<AgentSessionHistoryMessage[]>;
  attachRuntimeTranscriptSession: AgentOperationsContextValue["attachRuntimeTranscriptSession"];
  readSessionSlashCommands: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentSlashCommandCatalog>;
  readSessionFileSearch: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
  replyRuntimeSessionPermission?: AgentOperationsContextValue["replyRuntimeSessionPermission"];
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

const missingRuntimeSessionPermissionReply = async (): Promise<void> => {
  throw new Error("Runtime session permission replies are unavailable.");
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
  replyRuntimeSessionPermission = missingRuntimeSessionPermissionReply,
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
  replyRuntimeSessionPermission,
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
