import type {
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  CodexAppServerApprovalsReviewer,
  CodexAppServerAskForApproval,
  CodexAppServerFuzzyFileSearchParams,
  CodexAppServerFuzzyFileSearchResponse,
  CodexAppServerRequestId,
  CodexAppServerSandboxMode,
  CodexAppServerSandboxPolicy,
  CodexAppServerThreadListParams,
  RuntimeApprovalReplyOutcome,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentModelCatalog,
  AgentModelSelection,
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentRole,
  AgentSessionActivity,
  AgentSessionHistoryMessage,
  AgentSessionRuntimePolicy,
  AgentSessionSummary,
  AgentSkillCatalog,
  ForkAgentSessionInput,
  RepoRuntimeRef,
  RepoRuntimeRouteResolution,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import type { CodexPolicyLogEntry } from "./codex-session-policy";

export type CodexJsonRpcRequest = {
  method: string;
  params?: unknown;
};

export type CodexJsonRpcTransport = {
  request<Response = unknown>(request: CodexJsonRpcRequest): Promise<Response>;
};

export type CodexJsonRpcTransportFactory = (runtimeId: string) => CodexJsonRpcTransport;

export type CodexServerRequestRecord = {
  id?: CodexAppServerRequestId;
  method: string;
  params?: unknown;
};

export type CodexNotificationRecord = {
  method: string;
  params?: unknown;
  receivedAt: string;
};

export type CodexSessionContextUsage = {
  totalTokens: number;
  contextWindow?: number;
};

export type CodexLiveSessionLocator = {
  runtimeId: string;
  externalSessionId: string;
};

export type CodexLiveApprovalReplyInput = CodexLiveSessionLocator & {
  requestId: string;
  outcome: RuntimeApprovalReplyOutcome;
  message?: string;
};

export type CodexLiveQuestionReplyInput = CodexLiveSessionLocator & {
  requestId: string;
  answers: string[][];
};

export type CodexCatalogInvalidation = {
  runtimeId: string;
  catalog: "skills";
};

export type CodexServerRequestResponder = (
  runtimeId: string,
  requestId: CodexAppServerRequestId,
  result?: unknown,
  error?: unknown,
) => Promise<void>;

export type CodexAppServerStreamEvent = {
  runtimeId: string;
  kind: "notification" | "server_request";
  receivedAt: string;
  message: unknown;
};

export type CodexRepoRuntimeResolverPort = {
  requireRepoRuntime(ref: RepoRuntimeRef): Promise<RepoRuntimeRouteResolution>;
};

export type CodexModelCatalogRecord = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description?: string;
  }>;
  defaultReasoningEffort?: string | { reasoningEffort: string; description?: string };
  inputModalities: string[];
  supportsPersonality?: boolean;
  isDefault?: boolean;
};

export type CodexModelListResponse = {
  data: CodexModelCatalogRecord[];
  nextCursor: string | null;
};

export type CodexSkillRecord = {
  name?: unknown;
  path?: unknown;
  scope?: unknown;
  title?: unknown;
  displayName?: unknown;
  description?: unknown;
  enabled?: unknown;
};

export type CodexSkillsListParams = {
  cwd: string;
  forceReload?: boolean;
};

export type CodexSkillCatalogEntry = {
  cwd?: unknown;
  skills: CodexSkillRecord[];
};

export type CodexSkillsListResponse = {
  data?: unknown;
  errors?: unknown;
};

export type CodexModelSelectionPayload = {
  model: string;
  effort: string;
};

export type CodexTextElement = {
  byteRange: {
    start: number;
    end: number;
  };
  placeholder: string | null;
};

export type CodexUserInput =
  | {
      type: "text";
      text: string;
      text_elements?: CodexTextElement[];
    }
  | {
      type: "mention";
      name: string;
      path: string;
    }
  | {
      type: "skill";
      name: string;
      path: string;
    }
  | {
      type: "localImage";
      path: string;
    };

export type CodexInitializeParams = {
  clientInfo: {
    name: string;
    title?: string;
    version: string;
  };
  capabilities?: {
    experimentalApi: boolean;
    optOutNotificationMethods?: string[];
  };
};

export type CodexThreadStartParams = {
  approvalPolicy: CodexAppServerAskForApproval;
  approvalsReviewer: CodexAppServerApprovalsReviewer | null;
  cwd: string;
  developerInstructions: string;
  sandbox: CodexAppServerSandboxMode;
  model: string;
  effort: string;
};

export type CodexThreadResumeParams = {
  approvalPolicy: CodexAppServerAskForApproval;
  approvalsReviewer: CodexAppServerApprovalsReviewer | null;
  threadId: string;
  cwd: string;
  developerInstructions?: string;
  sandbox: CodexAppServerSandboxMode;
  model?: string;
  effort?: string;
  excludeTurns?: boolean;
};

export type CodexThreadForkParams = {
  approvalPolicy: CodexAppServerAskForApproval;
  approvalsReviewer: CodexAppServerApprovalsReviewer | null;
  threadId: string;
  cwd: string;
  developerInstructions: string;
  sandbox: CodexAppServerSandboxMode;
  model: string;
  effort: string;
};

export type CodexThreadSetNameParams = {
  threadId: string;
  name: string;
};

export type CodexThreadCompactStartParams = {
  threadId: string;
};

export type CodexThreadCompactStartResponse = Record<string, never>;

export type CodexTurnStartParams = {
  approvalPolicy: CodexAppServerAskForApproval;
  approvalsReviewer: CodexAppServerApprovalsReviewer | null;
  threadId: string;
  input: CodexUserInput[];
  sandboxPolicy: CodexAppServerSandboxPolicy;
  model?: string;
  effort?: string;
};

export type CodexTurnStartResult = {
  turnId?: string;
  turn?: {
    id?: string;
    turnId?: string;
  };
};

export type CodexTurnSteerParams = {
  threadId: string;
  input: CodexUserInput[];
  expectedTurnId: string;
};

export type CodexTurnSteerResult = {
  turnId?: string;
};

export type CodexTurnInterruptParams = {
  threadId: string;
  turnId: string;
};

export type CodexThreadStartResult = {
  thread?: {
    id?: string;
    threadId?: string;
  };
  threadId?: string;
  startedAt?: string;
};

export type CodexThreadResumeResult = {
  thread?: {
    id?: string;
    threadId?: string;
  };
  threadId?: string;
  startedAt?: string;
};

export type CodexThreadForkResult = {
  thread?: {
    id?: string;
    threadId?: string;
  };
  threadId?: string;
  startedAt?: string;
};

export type CodexSessionState = {
  summary: AgentSessionSummary;
  model?: AgentModelSelection;
  systemPrompt: string;
  role: AgentRole | null;
  runtimeId: string;
  repoPath: string;
  threadId: string;
  workingDirectory: string;
  taskId: string | null;
  runtimePolicy: AgentSessionRuntimePolicy;
  liveStatus?: {
    classification: AgentSessionActivity;
  };
};

export type CodexAppServerClient = {
  initialize(params: CodexInitializeParams): Promise<void>;
  modelList(): Promise<CodexModelListResponse>;
  skillsList(params: CodexSkillsListParams): Promise<CodexSkillsListResponse>;
  threadStart(params: CodexThreadStartParams): Promise<CodexThreadStartResult>;
  threadResume(params: CodexThreadResumeParams): Promise<CodexThreadResumeResult>;
  threadFork(params: CodexThreadForkParams): Promise<CodexThreadForkResult>;
  threadSetName(params: CodexThreadSetNameParams): Promise<Record<string, never>>;
  threadCompactStart(
    params: CodexThreadCompactStartParams,
  ): Promise<CodexThreadCompactStartResponse>;
  turnStart(params: CodexTurnStartParams): Promise<CodexTurnStartResult>;
  turnSteer(params: CodexTurnSteerParams): Promise<CodexTurnSteerResult>;
  turnInterrupt(params: CodexTurnInterruptParams): Promise<Record<string, never>>;
  fuzzyFileSearch(
    params: CodexAppServerFuzzyFileSearchParams,
  ): Promise<CodexAppServerFuzzyFileSearchResponse>;
  threadRead(params: { threadId: string; includeTurns?: boolean }): Promise<unknown>;
  threadList(params?: CodexAppServerThreadListParams): Promise<unknown>;
  threadLoadedList(params?: { limit?: number; cursor?: string | null }): Promise<unknown>;
  threadTurnsList(params: {
    threadId: string;
    limit?: number;
    cursor?: string | null;
    sortDirection?: "asc" | "desc";
    itemsView?: "notLoaded" | "summary" | "full";
  }): Promise<unknown>;
  turnDiff(params: { threadId: string; turnId?: string }): Promise<unknown>;
};

type CodexAppServerAdapterBaseOptions = {
  repoRuntimeResolver: CodexRepoRuntimeResolverPort;
  transportFactory: CodexJsonRpcTransportFactory;
  respondServerRequest?: CodexServerRequestResponder;
  onLiveSessionMutation?: (mutation: CodexLiveSessionMutation) => void | Promise<void>;
  onCatalogInvalidated?: (event: CodexCatalogInvalidation) => void | Promise<void>;
  logSessionPolicy?: (entry: CodexPolicyLogEntry) => void;
};

export type CodexAppServerEventSubscriber = (
  runtimeId: string,
  listener: (event: CodexAppServerStreamEvent) => void,
) => Promise<() => void> | (() => void);

export type CodexRuntimeEventQueueFailureHandler = (input: {
  runtimeId: string;
  error: unknown;
}) => undefined;

type CodexAppServerStreamingOptions = {
  subscribeEvents: CodexAppServerEventSubscriber;
  onRuntimeEventQueueFailure: CodexRuntimeEventQueueFailureHandler;
};

type CodexAppServerRequestOnlyOptions = {
  subscribeEvents?: undefined;
  onRuntimeEventQueueFailure?: never;
};

export type CodexAppServerAdapterOptions = CodexAppServerAdapterBaseOptions &
  (CodexAppServerStreamingOptions | CodexAppServerRequestOnlyOptions);

export type CodexLiveSessionMutation = {
  runtimeId: string;
  snapshots: AgentSessionLiveSnapshot[];
  transcriptEvents: AgentEvent[];
  catalogInvalidated: boolean;
  fault?: string;
  faultRef?: AgentSessionLiveRef;
};

export type {
  AgentEvent,
  AgentModelCatalog,
  AgentModelSelection,
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentRole,
  AgentSessionHistoryMessage,
  AgentSessionSummary,
  AgentSkillCatalog,
  CodexAppServerFuzzyFileSearchParams,
  CodexAppServerFuzzyFileSearchResponse,
  CodexPolicyLogEntry,
  ForkAgentSessionInput,
  ResumeAgentSessionInput,
  RuntimeDescriptor,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
};
