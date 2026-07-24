import type {
  AgentEvent,
  EventUnsubscribe,
  PolicyBoundSessionRef,
  ReplyApprovalInput,
  SessionRef,
} from "@openducktor/core";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { LoadSettingsSnapshotForRuntimePolicy } from "../support/session-runtime-policy";
import type { SessionTurnMetadata } from "../support/session-turn-metadata";
import type {
  BuildReadOnlyApprovalRejectionMessage,
  EnsureSession,
  ReadSession,
  RecordTurnTimestamp,
  ResolveTurnDuration,
  SessionEventContext,
  SessionEventSessionContext,
  SessionStoreContext,
  SessionTurnContext,
  UpdateSession,
  UpdateSessionTodos,
} from "./session-event-types";

export type SessionEventAdapter = {
  subscribeEvents: (
    session: PolicyBoundSessionRef,
    listener: (event: AgentEvent) => void,
  ) => Promise<EventUnsubscribe>;
  replyApproval: (input: ReplyApprovalInput) => Promise<void>;
};

export type ObserveAgentSessionParams = {
  adapter: SessionEventAdapter;
  sessionRef: PolicyBoundSessionRef;
  eventBatchWindowMs?: number;
  turnMetadata: SessionTurnMetadata;
  readSession: ReadSession;
  ensureSession: EnsureSession;
  updateSession: UpdateSession;
  updateSessionTodos: UpdateSessionTodos;
  isSessionObserved: (sessionIdentity: AgentSessionIdentity) => boolean;
  recordTurnActivityTimestamp: RecordTurnTimestamp;
  recordTurnUserMessageTimestamp: RecordTurnTimestamp;
  resolveTurnDurationMs: ResolveTurnDuration;
  clearTurnDuration: (sessionKey: string, completedTimestamp?: string) => void;
  buildReadOnlyApprovalRejectionMessage: BuildReadOnlyApprovalRejectionMessage;
  loadSettingsSnapshot?: LoadSettingsSnapshotForRuntimePolicy;
  readOnlyApprovalAutoRejectSafe: boolean;
};

type SessionEventContextParams = Omit<ObserveAgentSessionParams, "sessionRef"> & {
  sessionRef: SessionRef;
};

const createSessionContext = (context: SessionEventContextParams): SessionEventSessionContext => ({
  identity: toAgentSessionIdentity(context.sessionRef),
  key: agentSessionIdentityKey(context.sessionRef),
  repoPath: context.sessionRef.repoPath,
});

const createStoreContext = (context: SessionEventContextParams): SessionStoreContext => ({
  ensureSession: context.ensureSession,
  updateSession: context.updateSession,
  readSession: context.readSession,
  isSessionObserved: context.isSessionObserved,
});

const createTurnContext = (context: SessionEventContextParams): SessionTurnContext => ({
  turnMetadata: context.turnMetadata,
  recordTurnActivityTimestamp: context.recordTurnActivityTimestamp,
  recordTurnUserMessageTimestamp: context.recordTurnUserMessageTimestamp,
  resolveTurnDurationMs: context.resolveTurnDurationMs,
  clearTurnDuration: context.clearTurnDuration,
});

export const createSessionEventContext = (
  context: SessionEventContextParams,
): SessionEventContext => ({
  session: createSessionContext(context),
  store: createStoreContext(context),
  turn: createTurnContext(context),
  approvals: {
    replyApproval: context.adapter.replyApproval,
    buildReadOnlyApprovalRejectionMessage: context.buildReadOnlyApprovalRejectionMessage,
    readOnlyApprovalAutoRejectSafe: context.readOnlyApprovalAutoRejectSafe,
    ...(context.loadSettingsSnapshot ? { loadSettingsSnapshot: context.loadSettingsSnapshot } : {}),
  },
  todos: {
    updateSessionTodos: context.updateSessionTodos,
  },
});
