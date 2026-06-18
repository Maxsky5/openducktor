import type { AgentToolName } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentEvent,
  AgentRole,
  AgentSessionRef,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { SessionTurnMetadata } from "../support/session-turn-metadata";

export type PersistSessionUpdateOptions = { persist: true };

export type UpdateSession = (
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: PersistSessionUpdateOptions,
) => AgentSessionState | null;

export type ReadSession = (identity: AgentSessionIdentity) => AgentSessionState | null;

export type ResolveTurnDuration = (
  sessionKey: string,
  externalSessionId: string,
  timestamp: string,
  messages?: AgentSessionState["messages"],
) => number | undefined;

export type RecordTurnTimestamp = (sessionKey: string, timestamp: string | number) => void;
export type BuildReadOnlyApprovalRejectionMessage = (role: AgentRole) => Promise<string>;
export type WorkflowToolAliasesByCanonical = {
  [ToolName in AgentToolName]?: string[] | undefined;
};
export type UpdateSessionTodos = (
  updater: (current: AgentSessionTodoItem[]) => AgentSessionTodoItem[],
) => void;

export type SessionEventAdapter = Pick<AgentEnginePort, "subscribeEvents" | "replyApproval">;

export type SessionEvent = AgentEvent;
export type SessionPartEvent = Extract<SessionEvent, { type: "assistant_part" }>;
export type SessionPart = SessionPartEvent["part"];

export type ObserveAgentSessionParams = {
  adapter: SessionEventAdapter;
  sessionRef: AgentSessionRef;
  eventBatchWindowMs?: number;
  turnMetadata: SessionTurnMetadata;
  readSession: ReadSession;
  updateSession: UpdateSession;
  updateSessionTodos: UpdateSessionTodos;
  isSessionObserved: (sessionIdentity: AgentSessionIdentity) => boolean;
  recordTurnActivityTimestamp: RecordTurnTimestamp;
  recordTurnUserMessageTimestamp: RecordTurnTimestamp;
  resolveTurnDurationMs: ResolveTurnDuration;
  clearTurnDuration: (sessionKey: string, completedTimestamp?: string) => void;
  buildReadOnlyApprovalRejectionMessage: BuildReadOnlyApprovalRejectionMessage;
  readOnlyApprovalAutoRejectSafe: boolean;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  workflowToolAliasesByCanonical: WorkflowToolAliasesByCanonical | undefined;
};

export type SessionEventSessionContext = {
  identity: AgentSessionIdentity;
  key: string;
};

export type SessionStoreContext = Pick<
  ObserveAgentSessionParams,
  "updateSession" | "isSessionObserved"
> & {
  readSession: ReadSession;
};

export type SessionTodosContext = Pick<ObserveAgentSessionParams, "updateSessionTodos">;

export type SessionTurnContext = Pick<
  ObserveAgentSessionParams,
  | "turnMetadata"
  | "recordTurnActivityTimestamp"
  | "recordTurnUserMessageTimestamp"
  | "resolveTurnDurationMs"
  | "clearTurnDuration"
>;

export type SessionApprovalContext = {
  repoPath: string;
} & Pick<
  ObserveAgentSessionParams,
  "adapter" | "readOnlyApprovalAutoRejectSafe" | "buildReadOnlyApprovalRejectionMessage"
>;

export type SessionRefreshContext = { repoPath: string } & Pick<
  ObserveAgentSessionParams,
  "refreshTaskData" | "workflowToolAliasesByCanonical"
>;

export type SessionEventContext = {
  session: SessionEventSessionContext;
  store: SessionStoreContext;
  turn: SessionTurnContext;
  approvals: SessionApprovalContext;
  refresh: SessionRefreshContext;
  todos: SessionTodosContext;
};

export type SessionLifecycleEventContext = Pick<
  SessionEventContext,
  "session" | "store" | "turn" | "approvals" | "todos"
>;

export type SessionPartEventContext = Pick<
  SessionEventContext,
  "session" | "store" | "turn" | "refresh" | "todos"
>;

export type SessionToolPartEventContext = Pick<
  SessionPartEventContext,
  "session" | "store" | "refresh" | "todos"
>;

const createSessionContext = (context: ObserveAgentSessionParams): SessionEventSessionContext => ({
  identity: context.sessionRef,
  key: agentSessionIdentityKey(context.sessionRef),
});

const createStoreContext = (context: ObserveAgentSessionParams): SessionStoreContext => ({
  updateSession: context.updateSession,
  readSession: context.readSession,
  isSessionObserved: context.isSessionObserved,
});

const createTurnContext = (context: ObserveAgentSessionParams): SessionTurnContext => ({
  turnMetadata: context.turnMetadata,
  recordTurnActivityTimestamp: context.recordTurnActivityTimestamp,
  recordTurnUserMessageTimestamp: context.recordTurnUserMessageTimestamp,
  resolveTurnDurationMs: context.resolveTurnDurationMs,
  clearTurnDuration: context.clearTurnDuration,
});

export const createSessionEventContext = (
  context: ObserveAgentSessionParams,
): SessionEventContext => {
  const session = createSessionContext(context);
  const store = createStoreContext(context);
  const turn = createTurnContext(context);

  return {
    session,
    store,
    turn,
    approvals: {
      repoPath: context.sessionRef.repoPath,
      adapter: context.adapter,
      buildReadOnlyApprovalRejectionMessage: context.buildReadOnlyApprovalRejectionMessage,
      readOnlyApprovalAutoRejectSafe: context.readOnlyApprovalAutoRejectSafe,
    },
    refresh: {
      repoPath: context.sessionRef.repoPath,
      refreshTaskData: context.refreshTaskData,
      workflowToolAliasesByCanonical: context.workflowToolAliasesByCanonical,
    },
    todos: {
      updateSessionTodos: context.updateSessionTodos,
    },
  };
};
