import type {
  GitTargetBranch,
  HostRuntimeEvent,
  RepoActions,
  RuntimeApprovalReplyOutcome,
  RuntimeKind,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentSessionScope,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentUserMessagePart,
  LoadAgentSessionHistoryInput,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import type {
  AgentMessageSendOptions,
  AgentMessageSendReceipt,
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionContextLoadTarget,
  AgentSessionIdentity,
  AgentSessionState,
} from "./agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "./agent-session-read-model";
import type { AgentSessionTransientFault } from "./agent-session-transient-fault";
import type { HostRuntimeStatusMap, HostStatusSnapshot } from "./diagnostics";

export type ActiveWorkspace = Pick<WorkspaceRecord, "workspaceId" | "workspaceName" | "repoPath">;

export type RepoAgentDefaultInput = {
  runtimeKind?: RuntimeKind | null;
  providerId: string;
  modelId: string;
  variant: string;
  profileId: string;
};

export type RepoSettingsInput = {
  defaultModel: RepoAgentDefaultInput | null;
  worktreeBasePath: string;
  branchPrefix: string;
  /** Default branch used for ahead/behind comparison, rebase, and PR creation. */
  defaultTargetBranch: GitTargetBranch;
  postCompleteHooks: string[];
  actions: RepoActions;
  /** Paths copied from the main repo into a new worktree on creation. */
  worktreeCopyPaths: string[];
  agentDefaults: {
    spec: RepoAgentDefaultInput | null;
    planner: RepoAgentDefaultInput | null;
    build: RepoAgentDefaultInput | null;
    qa: RepoAgentDefaultInput | null;
  };
};

/** The health of live host runtime updates. */
export type HostRuntimeStreamHealth = {
  /** Live runtime updates are unavailable. */
  error: string | null;
  /** Changes each time live updates fail or recover. */
  epoch: number;
};

export type HostRuntimeEventListener = {
  onEvent: (event: HostRuntimeEvent) => void;
  /** Live updates failed or recovered. `getStreamHealth` returns the new state. */
  onStreamChange: () => void;
};

/** The host runtime event stream. The host runtime status owner is its only subscriber. */
export type HostRuntimeEvents = {
  subscribeEvents: (listener: HostRuntimeEventListener) => () => void;
  getStreamHealth: () => HostRuntimeStreamHealth;
};

export type HostRuntimeStatusContextValue = {
  snapshot: HostStatusSnapshot | null;
  statusByKind: HostRuntimeStatusMap;
  /** True only with live updates and a successful baseline read. */
  isCurrent: boolean;
  isLoading: boolean;
  readError: string | null;
  streamError: string | null;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  runtimeEvents: HostRuntimeEvents;
};

export type AgentSessionReadModelStateContextValue = {
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  workspaceSessionRecordsError: string | null;
  reloadSessionReadModel: () => void;
  getSessionFault: (session: AgentSessionIdentity | null) => AgentSessionTransientFault | null;
};

export type AgentSessionHistoryLoadContextValue = {
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>;
};

export type AgentOperationsContextValue = {
  describeGeneratedImages: import("@openducktor/core").AgentEnginePort["describeGeneratedImages"];
  beginGeneratedImageBatch: import("@openducktor/core").AgentEnginePort["beginGeneratedImageBatch"];
  releaseGeneratedImageBatch: import("@openducktor/core").AgentEnginePort["releaseGeneratedImageBatch"];
  readGeneratedImage: import("@openducktor/core").AgentEnginePort["readGeneratedImage"];
  readSessionTodos: (session: PolicyBoundSessionRef) => Promise<AgentSessionTodoItem[]>;
  readSessionHistory: (
    session: LoadAgentSessionHistoryInput,
  ) => Promise<AgentSessionHistoryMessage[]>;
  /** Reads the full details of a tool part that compact history cut. */
  readSessionToolPart: import("@openducktor/core").AgentEnginePort["loadSessionToolPart"];
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>;
  loadAgentSessionContext: (session: AgentSessionContextLoadTarget) => Promise<void>;
  sendAgentMessage: (
    session: AgentSessionIdentity,
    parts: AgentUserMessagePart[],
    options?: AgentMessageSendOptions,
  ) => Promise<AgentMessageSendReceipt | null>;
  /** Edits, removes, or steers one queued message, or resumes a paused queue. */
  manageAgentMessageQueue: (
    session: AgentSessionIdentity,
    action: import("@openducktor/contracts").AgentMessageQueueAction,
  ) => Promise<void>;
  stopAgentSession: (session: AgentSessionIdentity) => Promise<void>;
  continueInterruptedTurn: (session: AgentSessionIdentity) => Promise<void>;
  updateAgentSessionModel: (
    session: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ) => Promise<void>;
  replyAgentApproval: (
    session: AgentSessionIdentity,
    request: AgentApprovalRequest,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (
    session: AgentSessionIdentity,
    request: AgentQuestionRequest,
    answers: string[][],
    sessionScope?: AgentSessionScope,
  ) => Promise<void>;
};
