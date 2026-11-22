import type { AgentToolDenialSource } from "@openducktor/contracts";
import type { ManagedMcpServerResolver, WorkflowRolePolicyResolver } from "@openducktor/core";
import type { CodexImageGenerationPreparer } from "./codex-image-generation";
import type {
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  CodexAppServerAccountRateLimitsResponse,
  CodexAppServerConfigReadParams,
  CodexAppServerConfigReadResponse,
  CodexAppServerConfigRequirementsReadResponse,
  CodexAppServerModelListResponse,
  CodexAppServerSkillsListResponse,
  CodexAppServerInitializeParams,
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
  CodexAppServerClientRequest,
  CodexAppServerFuzzyFileSearchParams,
  CodexAppServerFuzzyFileSearchResponse,
  CodexAppServerRequestId,
  CodexAppServerRequestResult,
  CodexAppServerRuntimeStreamEvent,
  CodexAppServerRespondError,
  CodexAppServerRespondResult,
  CodexAppServerSkillsListParams,
  CodexAppServerThreadCompactStartParams,
  CodexAppServerThreadCompactStartResult,
  CodexAppServerThreadGoalClearParams,
  CodexAppServerThreadGoalClearResult,
  CodexAppServerThreadGoalSetParams,
  CodexAppServerThreadSettingsUpdateParams,
  CodexAppServerThreadBackgroundTerminalsCleanParams,
  CodexAppServerThreadBackgroundTerminalsListParams,
  CodexAppServerThreadBackgroundTerminalsListResult,
  CodexAppServerThreadBackgroundTerminalsTerminateParams,
  CodexAppServerThreadBackgroundTerminalsTerminateResult,
  CodexAppServerThreadUnsubscribeParams,
  CodexAppServerThreadUnsubscribeResult,
  CodexAppServerThreadGoalSetResult,
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
  RuntimeApprovalReplyOutcome,
  CodexAppServerRequestParamsMap,
} from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentModelSelection,
  AgentSessionActivity,
  AgentSessionRuntimePolicy,
  AgentSessionSummary,
  BoundRuntimeRoute,
} from "@openducktor/core";
import type { CodexPolicyLogEntry } from "./codex-session-policy";
import type { CodexQuestionHistory } from "./codex-question-history";
import type { CodexFirstTurnHistory } from "./codex-first-turn-history";
import type {
  CodexRuntimeNotification,
  CodexRuntimeServerRequest,
} from "./codex-runtime-event-schema";
export type CodexJsonRpcRequest = CodexAppServerClientRequest;

export type CodexJsonRpcTransport = {
  request(request: CodexJsonRpcRequest): Promise<CodexAppServerRequestResult>;
};

type CodexJsonRpcTransportFactory = (runtimeId: string) => CodexJsonRpcTransport;

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
  onIssued?: (() => void) | undefined;
  requestId: string;
  outcome: RuntimeApprovalReplyOutcome;
  message?: string;
  /** The host rejects the request for the read-only role, not for the user. */
  denialSource?: Extract<AgentToolDenialSource, "read_only_role"> | undefined;
};

export type CodexLiveQuestionReplyInput = CodexLiveSessionLocator & {
  requestId: string;
  answers: string[][];
};

type CodexCatalogInvalidation = {
  runtimeId: string;
  catalog: "skills";
};

export type CodexServerRequestResponder = (
  runtimeId: string,
  requestId: CodexAppServerRequestId,
  result?: CodexAppServerRespondResult,
  error?: CodexAppServerRespondError,
  onIssued?: () => void,
) => Promise<void>;

export type CodexAppServerStreamEvent = CodexAppServerRuntimeStreamEvent;

export type CodexModelListResponse = CodexAppServerModelListResponse;

export type CodexSkillsListParams = CodexAppServerSkillsListParams;

export type CodexUserInput = CodexAppServerUserInput;
export type CodexTextElement = Extract<CodexUserInput, { type: "text" }>["text_elements"][number];

export type CodexThreadStartParams = CodexAppServerThreadStartParams;
export type CodexThreadResumeParams = CodexAppServerThreadResumeParams;
export type CodexThreadForkParams = CodexAppServerThreadForkParams;
export type CodexThreadSetNameParams = CodexAppServerThreadSetNameParams;
export type CodexThreadCompactStartParams = CodexAppServerThreadCompactStartParams;

export type CodexTurnStartParams = CodexAppServerTurnStartParams;
export type CodexTurnStartResult = CodexAppServerTurnStartResult;

export type CodexTurnSteerParams = CodexAppServerTurnSteerParams;

export type CodexTurnInterruptParams = CodexAppServerTurnInterruptParams;
export type CodexThreadStartResult = CodexAppServerThreadStartResult;
export type CodexThreadResumeResult = CodexAppServerThreadResumeResult;
export type CodexThreadForkResult = CodexAppServerThreadForkResult;

export type CodexThreadHistoryReadResponse = CodexAppServerThreadReadResponse;

export type CodexSessionState = {
  summary: AgentSessionSummary;
  nativeName?: string | null;
  contextOwnerThreadId?: string;
  model?: AgentModelSelection;
  systemPrompt: string;
  runtimeId: string;
  repoPath: string;
  threadId: string;
  workingDirectory: string;
  runtimePolicy: AgentSessionRuntimePolicy;
  preserveNativeSettings?: boolean;
  /**
   * Codex takes `turn/start` and approvals from OpenDucktor on this thread. Codex refuses direct
   * input to a multi-agent v2 child thread. `null`: Codex did not report it.
   */
  canAcceptDirectInput?: boolean | null;
  firstTurnHistory?: CodexFirstTurnHistory;
  liveStatus?: {
    classification: AgentSessionActivity;
  };
};

export type CodexAppServerClient = {
  initialize(params: CodexAppServerInitializeParams): Promise<void>;
  configRead(params: CodexAppServerConfigReadParams): Promise<CodexAppServerConfigReadResponse>;
  configRequirementsRead(): Promise<CodexAppServerConfigRequirementsReadResponse>;
  modelList(): Promise<CodexModelListResponse>;
  skillsList(params: CodexSkillsListParams): Promise<CodexAppServerSkillsListResponse>;
  threadStart(params: CodexThreadStartParams): Promise<CodexThreadStartResult>;
  threadResume(params: CodexThreadResumeParams): Promise<CodexThreadResumeResult>;
  threadFork(params: CodexThreadForkParams): Promise<CodexThreadForkResult>;
  threadSetName(params: CodexThreadSetNameParams): Promise<CodexAppServerThreadSetNameResult>;
  threadCompactStart(
    params: CodexThreadCompactStartParams,
  ): Promise<CodexAppServerThreadCompactStartResult>;
  threadGoalSet(
    params: CodexAppServerThreadGoalSetParams,
  ): Promise<CodexAppServerThreadGoalSetResult>;
  threadGoalClear(
    params: CodexAppServerThreadGoalClearParams,
  ): Promise<CodexAppServerThreadGoalClearResult>;
  threadUnsubscribe(
    params: CodexAppServerThreadUnsubscribeParams,
  ): Promise<CodexAppServerThreadUnsubscribeResult>;
  threadSettingsUpdate(
    params: CodexAppServerThreadSettingsUpdateParams,
  ): Promise<CodexAppServerThreadSetNameResult>;
  /** Tells the model that the user approved the action of a denied auto-review. */
  threadApproveGuardianDeniedAction(
    params: CodexAppServerRequestParamsMap["thread/approveGuardianDeniedAction"],
  ): Promise<CodexAppServerThreadSetNameResult>;
  /** Stops one background terminal. Codex answers after the process exits. */
  threadBackgroundTerminalsTerminate(
    params: CodexAppServerThreadBackgroundTerminalsTerminateParams,
  ): Promise<CodexAppServerThreadBackgroundTerminalsTerminateResult>;
  /** Lists one page of the running background terminals of a thread. */
  threadBackgroundTerminalsList(
    params: CodexAppServerThreadBackgroundTerminalsListParams,
  ): Promise<CodexAppServerThreadBackgroundTerminalsListResult>;
  /** Stops every background terminal of a thread. */
  threadBackgroundTerminalsClean(
    params: CodexAppServerThreadBackgroundTerminalsCleanParams,
  ): Promise<CodexAppServerThreadSetNameResult>;
  turnStart(params: CodexTurnStartParams): Promise<CodexTurnStartResult>;
  turnSteer(params: CodexTurnSteerParams): Promise<CodexAppServerTurnSteerResult>;
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
  /** The usage of the signed-in account. */
  accountRateLimitsRead(): Promise<CodexAppServerAccountRateLimitsResponse>;
};

type CodexAppServerAdapterBaseOptions = {
  /** The one Codex runtime this adapter instance controls. */
  runtime: BoundRuntimeRoute;
  /** Resolves the managed MCP server sent with every thread start, resume, and fork. */
  resolveManagedMcpServer: ManagedMcpServerResolver;
  /** Compares native and saved directory paths without changing the saved session identity. */
  directoriesMatch: (left: string, right: string) => Promise<boolean>;
  /** The tools and workspace access of a workflow role in the task workflow of the session task. */
  resolveWorkflowRolePolicy: WorkflowRolePolicyResolver;
  transportFactory: CodexJsonRpcTransportFactory;
  respondServerRequest?: CodexServerRequestResponder;
  onLiveSessionMutation?: (mutation: CodexLiveSessionMutation) => void | Promise<void>;
  onCatalogInvalidated?: (event: CodexCatalogInvalidation) => void | Promise<void>;
  prepareImageGenerations?: CodexImageGenerationPreparer;
  logSessionPolicy?: (entry: CodexPolicyLogEntry) => void;
  questionHistory?: CodexQuestionHistory;
  /**
   * The version that the host read from the Codex executable, or `null` when it could not read
   * it. Without this reader, the version is unknown, so no background terminal offers Stop.
   */
  readRuntimeVersion?: () => string | null;
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

export type CodexLiveSessionMutation = { provenance?: "baseline" | "live" } & (
  | { snapshotMode: "full"; removedRefs?: never }
  | { snapshotMode: "delta"; removedRefs: AgentSessionLiveRef[] }
) & {
    runtimeId: string;
    snapshots: AgentSessionLiveSnapshot[];
    transcriptEvents: AgentEvent[];
    catalogInvalidated: boolean;
    fault?: string;
    faultRef?: AgentSessionLiveRef;
  };

export type { CodexAppServerFuzzyFileSearchParams, CodexAppServerFuzzyFileSearchResponse };
