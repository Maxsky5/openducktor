import type {
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  CodexAppServerModel,
  CodexAppServerModelListResponse,
  CodexAppServerSkillCatalogEntry,
  CodexAppServerSkillRecord,
  CodexAppServerSkillsListResponse,
  CodexAppServerInitializeParams,
  CodexAppServerThread,
  CodexAppServerThreadForkResult,
  CodexAppServerThreadLoadedListResponse,
  CodexAppServerThreadLoadedListParams,
  CodexAppServerThreadListResponse,
  CodexAppServerThreadReadParams,
  CodexAppServerThreadReadResponse,
  CodexAppServerThreadResumeResult,
  CodexAppServerThreadStartResult,
  CodexAppServerThreadTurnsListResponse,
  CodexAppServerThreadTurnsListParams,
  CodexAppServerJsonValue,
  CodexAppServerFuzzyFileSearchParams,
  CodexAppServerFuzzyFileSearchResponse,
  CodexAppServerRequestId,
  CodexAppServerSkillsListParams,
  CodexAppServerThreadCompactStartParams,
  CodexAppServerThreadCompactStartResult,
  CodexAppServerThreadForkParams,
  CodexAppServerThreadListParams,
  CodexAppServerThreadResumeParams,
  CodexAppServerThreadSetNameParams,
  CodexAppServerThreadStartParams,
  CodexAppServerThreadSetNameResult,
  CodexAppServerTurnInterruptResult,
  CodexAppServerTurnStartResult,
  CodexAppServerTurnSteerResult,
  CodexAppServerTurnInterruptParams,
  CodexAppServerTurnStartParams,
  CodexAppServerTurnSteerParams,
  CodexAppServerUserInput,
  JsonValue,
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
import type {
  CodexRuntimeNotification,
  CodexRuntimeServerRequest,
} from "./codex-runtime-event-schema";
export type CodexJsonRpcRequest = {
  method: string;
  params?: JsonValue | undefined;
};

export type CodexJsonRpcTransport = {
  request(request: CodexJsonRpcRequest): Promise<JsonValue>;
};

export type CodexJsonRpcTransportFactory = (runtimeId: string) => CodexJsonRpcTransport;

export type CodexServerRequestRecord = CodexRuntimeServerRequest;

export type CodexNotificationRecord = CodexRuntimeNotification & {
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
  result?: CodexAppServerJsonValue,
  cause?: unknown,
) => Promise<void>;

export type CodexAppServerStreamEvent = {
  runtimeId: string;
  kind: "notification" | "server_request";
  receivedAt: string;
  message: JsonValue;
};

export type CodexRepoRuntimeResolverPort = {
  requireRepoRuntime(ref: RepoRuntimeRef): Promise<RepoRuntimeRouteResolution>;
};

export type CodexModelCatalogRecord = CodexAppServerModel;

export type CodexModelListResponse = CodexAppServerModelListResponse;

export type CodexSkillRecord = CodexAppServerSkillRecord;

export type CodexSkillsListParams = CodexAppServerSkillsListParams;

export type CodexSkillCatalogEntry = CodexAppServerSkillCatalogEntry;

export type CodexSkillsListResponse = CodexAppServerSkillsListResponse;

export type CodexModelSelectionPayload = {
  model: string;
  effort: string;
};

export type CodexUserInput = CodexAppServerUserInput;
export type CodexTextElement = Extract<CodexUserInput, { type: "text" }>["text_elements"][number];

export type CodexInitializeParams = CodexAppServerInitializeParams;
export type CodexThreadStartParams = CodexAppServerThreadStartParams;
export type CodexThreadResumeParams = CodexAppServerThreadResumeParams;
export type CodexThreadForkParams = CodexAppServerThreadForkParams;
export type CodexThreadSetNameParams = CodexAppServerThreadSetNameParams;
export type CodexThreadCompactStartParams = CodexAppServerThreadCompactStartParams;

export type CodexThreadCompactStartResponse = CodexAppServerThreadCompactStartResult;

export type CodexTurnStartParams = CodexAppServerTurnStartParams;
export type CodexTurnStartResult = CodexAppServerTurnStartResult;

export type CodexTurnSteerParams = CodexAppServerTurnSteerParams;
export type CodexTurnSteerResult = CodexAppServerTurnSteerResult;

export type CodexTurnInterruptParams = CodexAppServerTurnInterruptParams;
export type CodexThreadStartResult = CodexAppServerThreadStartResult;
export type CodexThreadResumeResult = CodexAppServerThreadResumeResult;
export type CodexThreadForkResult = CodexAppServerThreadForkResult;

export type CodexUnmaterializedThread = Pick<CodexAppServerThread, "id" | "turns"> & {
  cwd?: CodexAppServerThread["cwd"];
};

export type CodexThreadHistoryReadResponse = {
  thread: CodexAppServerThread | CodexUnmaterializedThread;
};

export type CodexSessionState = {
  summary: AgentSessionSummary;
  model?: AgentModelSelection;
  systemPrompt: string;
  runtimeId: string;
  repoPath: string;
  threadId: string;
  workingDirectory: string;
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
  threadSetName(params: CodexThreadSetNameParams): Promise<CodexAppServerThreadSetNameResult>;
  threadCompactStart(
    params: CodexThreadCompactStartParams,
  ): Promise<CodexThreadCompactStartResponse>;
  turnStart(params: CodexTurnStartParams): Promise<CodexTurnStartResult>;
  turnSteer(params: CodexTurnSteerParams): Promise<CodexTurnSteerResult>;
  turnInterrupt(params: CodexTurnInterruptParams): Promise<CodexAppServerTurnInterruptResult>;
  fuzzyFileSearch(
    params: CodexAppServerFuzzyFileSearchParams,
  ): Promise<CodexAppServerFuzzyFileSearchResponse>;
  threadRead(params: CodexAppServerThreadReadParams): Promise<CodexAppServerThreadReadResponse>;
  threadList(params?: CodexAppServerThreadListParams): Promise<CodexAppServerThreadListResponse>;
  threadLoadedList(
    params?: CodexAppServerThreadLoadedListParams,
  ): Promise<CodexAppServerThreadLoadedListResponse>;
  threadTurnsList(
    params: CodexAppServerThreadTurnsListParams,
  ): Promise<CodexAppServerThreadTurnsListResponse>;
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
