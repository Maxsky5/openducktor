import type {
  AgentEvent,
  AgentRole,
  AgentSessionTodoItem,
  ReplyApprovalInput,
  SessionRef,
} from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { LoadSettingsSnapshotForRuntimePolicy } from "../support/session-runtime-policy";
import type { SessionTurnMetadata } from "../support/session-turn-metadata";

export type PersistSessionUpdateOptions = { persist: true };

export type UpdateSession = (
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: PersistSessionUpdateOptions,
) => AgentSessionState | null;

export type ReadSession = (identity: AgentSessionIdentity) => AgentSessionState | null;
export type EnsureSession = (
  identity: AgentSessionIdentity,
  createSession: () => AgentSessionState,
) => AgentSessionState;

export type ResolveTurnDuration = (
  sessionKey: string,
  externalSessionId: string,
  timestamp: string,
  messages?: AgentSessionState["messages"],
) => number | undefined;

export type RecordTurnTimestamp = (sessionKey: string, timestamp: string | number) => void;
export type BuildReadOnlyApprovalRejectionMessage = (role: AgentRole) => Promise<string>;
export type UpdateSessionTodos = (
  session: SessionRef,
  updater: (current: AgentSessionTodoItem[]) => AgentSessionTodoItem[],
) => void;

export type SessionEvent = AgentEvent;
export type SessionPartEvent = Extract<SessionEvent, { type: "assistant_part" }>;
export type SessionPart = SessionPartEvent["part"];

export type SessionEventSessionContext = {
  identity: AgentSessionIdentity;
  key: string;
  repoPath: string;
};

export type SessionStoreContext = {
  updateSession: UpdateSession;
  isSessionObserved: (sessionIdentity: AgentSessionIdentity) => boolean;
  readSession: ReadSession;
  ensureSession: EnsureSession;
};

export type SessionTodosContext = { updateSessionTodos: UpdateSessionTodos };

export type SessionTurnContext = {
  turnMetadata: SessionTurnMetadata;
  recordTurnActivityTimestamp: RecordTurnTimestamp;
  recordTurnUserMessageTimestamp: RecordTurnTimestamp;
  resolveTurnDurationMs: ResolveTurnDuration;
  clearTurnDuration: (sessionKey: string, completedTimestamp?: string) => void;
};

export type SessionApprovalContext = {
  replyApproval: (input: ReplyApprovalInput) => Promise<void>;
  readOnlyApprovalAutoRejectSafe: boolean;
  buildReadOnlyApprovalRejectionMessage: BuildReadOnlyApprovalRejectionMessage;
  loadSettingsSnapshot?: LoadSettingsSnapshotForRuntimePolicy;
};

export type SessionEventContext = {
  session: SessionEventSessionContext;
  store: SessionStoreContext;
  turn: SessionTurnContext;
  approvals: SessionApprovalContext;
  todos: SessionTodosContext;
};

export type SessionLifecycleEventContext = Pick<
  SessionEventContext,
  "session" | "store" | "turn" | "todos"
>;

export type SessionTranscriptEventContext = Pick<
  SessionEventContext,
  "session" | "store" | "turn" | "todos"
>;

export type SessionPartEventContext = Pick<
  SessionEventContext,
  "session" | "store" | "turn" | "todos"
>;

export type SessionToolPartEventContext = Pick<
  SessionPartEventContext,
  "session" | "store" | "todos"
>;
