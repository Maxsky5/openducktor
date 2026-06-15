import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentEvent,
  AgentRole,
  AgentSessionRef,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { SessionDraftBuffers, SessionTurnMetadata } from "../support/session-transient-state";

export type {
  DraftChannel,
  DraftChannelValueMap,
  DraftSource,
} from "../support/session-transient-state";

export type UpdateSession = (
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
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
  draftBuffers: SessionDraftBuffers;
  turnMetadata: SessionTurnMetadata;
  readSession: ReadSession;
  updateSession: UpdateSession;
  updateSessionTodos: UpdateSessionTodos;
  hasSessionObserver?: (sessionIdentity: AgentSessionIdentity) => boolean;
  recordTurnActivityTimestamp: RecordTurnTimestamp;
  recordTurnUserMessageTimestamp: RecordTurnTimestamp;
  resolveTurnDurationMs: ResolveTurnDuration;
  clearTurnDuration: (sessionKey: string, completedTimestamp?: string) => void;
  buildReadOnlyApprovalRejectionMessage: BuildReadOnlyApprovalRejectionMessage;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  resolveRuntimeDefinition?: (runtimeKind: RuntimeKind) => RuntimeDescriptor | null;
};

type SessionEventTargetContext = {
  sessionIdentity: AgentSessionIdentity;
  sessionKey: string;
  externalSessionId: string;
};

export type SessionStoreContext = SessionEventTargetContext &
  Pick<ObserveAgentSessionParams, "updateSession" | "hasSessionObserver"> & {
    readSession: ReadSession;
    hasSession: (identity: AgentSessionIdentity) => boolean;
  };

export type SessionRuntimeDataContext = Pick<ObserveAgentSessionParams, "updateSessionTodos">;

export type SessionDraftContext = SessionEventTargetContext & {
  buffers: SessionDraftBuffers;
};

export type SessionTurnContext = SessionEventTargetContext &
  Pick<
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
  "adapter" | "resolveRuntimeDefinition" | "buildReadOnlyApprovalRejectionMessage"
>;

export type SessionRefreshContext = { repoPath: string } & Pick<
  ObserveAgentSessionParams,
  "refreshTaskData" | "resolveRuntimeDefinition"
>;

export type SessionLifecycleEventContext = {
  store: SessionStoreContext;
  drafts: SessionDraftContext;
  turn: SessionTurnContext;
  approvals: SessionApprovalContext;
  runtimeData: SessionRuntimeDataContext;
};

export type SessionPartEventContext = {
  store: SessionStoreContext;
  drafts: SessionDraftContext;
  turn: SessionTurnContext;
  refresh: SessionRefreshContext;
  runtimeData: SessionRuntimeDataContext;
};

export type SessionToolPartEventContext = Pick<
  SessionPartEventContext,
  "store" | "refresh" | "runtimeData"
>;

export type SessionEventHandlerContext = {
  lifecycle: SessionLifecycleEventContext;
  parts: SessionPartEventContext;
};

const createTargetContext = (context: ObserveAgentSessionParams): SessionEventTargetContext => ({
  sessionIdentity: context.sessionRef,
  sessionKey: agentSessionIdentityKey(context.sessionRef),
  externalSessionId: context.sessionRef.externalSessionId,
});

const createStoreContext = (
  context: ObserveAgentSessionParams,
  target: SessionEventTargetContext,
): SessionStoreContext => ({
  ...target,
  updateSession: context.updateSession,
  readSession: context.readSession,
  hasSession: (identity) => context.readSession(identity) !== null,
});

const createDraftContext = (
  context: ObserveAgentSessionParams,
  target: SessionEventTargetContext,
): SessionDraftContext => ({
  ...target,
  buffers: context.draftBuffers,
});

const createTurnContext = (
  context: ObserveAgentSessionParams,
  target: SessionEventTargetContext,
): SessionTurnContext => ({
  ...target,
  turnMetadata: context.turnMetadata,
  recordTurnActivityTimestamp: context.recordTurnActivityTimestamp,
  recordTurnUserMessageTimestamp: context.recordTurnUserMessageTimestamp,
  resolveTurnDurationMs: context.resolveTurnDurationMs,
  clearTurnDuration: context.clearTurnDuration,
});

const createRuntimeDataContext = (
  context: ObserveAgentSessionParams,
): SessionRuntimeDataContext => ({
  updateSessionTodos: context.updateSessionTodos,
});

const createRefreshContext = (context: ObserveAgentSessionParams): SessionRefreshContext => ({
  repoPath: context.sessionRef.repoPath,
  refreshTaskData: context.refreshTaskData,
  ...(context.resolveRuntimeDefinition
    ? { resolveRuntimeDefinition: context.resolveRuntimeDefinition }
    : {}),
});

export const createSessionEventHandlerContext = (
  context: ObserveAgentSessionParams,
): SessionEventHandlerContext => {
  const target = createTargetContext(context);
  const store = createStoreContext(context, target);
  const lifecycleStore = context.hasSessionObserver
    ? { ...store, hasSessionObserver: context.hasSessionObserver }
    : store;
  const drafts = createDraftContext(context, target);
  const turn = createTurnContext(context, target);
  const runtimeData = createRuntimeDataContext(context);

  return {
    lifecycle: {
      store: lifecycleStore,
      drafts,
      turn,
      approvals: {
        repoPath: context.sessionRef.repoPath,
        adapter: context.adapter,
        buildReadOnlyApprovalRejectionMessage: context.buildReadOnlyApprovalRejectionMessage,
        ...(context.resolveRuntimeDefinition
          ? { resolveRuntimeDefinition: context.resolveRuntimeDefinition }
          : {}),
      },
      runtimeData,
    },
    parts: {
      store,
      drafts,
      turn,
      refresh: createRefreshContext(context),
      runtimeData,
    },
  };
};
