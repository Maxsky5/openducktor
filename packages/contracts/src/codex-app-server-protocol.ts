// Source-grounded Codex app-server protocol facade.
// Reference schema:
// https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/typescript

import type {
  CodexAppServerParsedClientRequest,
  CodexAppServerRequestParamsMap,
  CodexAppServerRequestReasoningEffort,
} from "./codex-app-server-request-schemas";
import type {
  CodexAppServerAdditionalFileSystemPermissions,
  CodexAppServerAdditionalNetworkPermissions,
  CodexAppServerCommandExecutionApprovalDecision,
  CodexAppServerCurrentTimeReadResponse,
  CodexAppServerNetworkPolicyAmendment,
  CodexAppServerThread,
  CodexAppServerThreadItem,
  CodexAppServerThreadStatus,
  CodexAppServerRequestResultMap,
} from "./codex-app-server-protocol-schemas";
import type { JsonValue } from "./json-types";
import type { CodexAppServerWireServerRequest } from "./codex-app-server-runtime-schemas";

export {
  codexAppServerClientRequestSchema,
  codexAppServerReasoningEffortSchema,
  codexAppServerRequestParamsSchemas,
  parseCodexAppServerClientRequest,
} from "./codex-app-server-request-schemas";
export {
  codexAppServerRequestResultSchema,
  parseCodexAppServerRequestResultValue as parseCodexAppServerRequestResult,
} from "./codex-app-server-protocol-schemas";
export type {
  CodexAppServerAdditionalFileSystemPermissions,
  CodexAppServerAdditionalNetworkPermissions,
  CodexAppServerCodexErrorInfo,
  CodexAppServerCommandAction,
  CodexAppServerCommandExecutionApprovalDecision,
  CodexAppServerCommandExecutionRequestApprovalParams,
  CodexAppServerCurrentTimeReadParams,
  CodexAppServerCurrentTimeReadResponse,
  CodexAppServerExecCommandApprovalParams,
  CodexAppServerFileSystemPath,
  CodexAppServerFileSystemSandboxEntry,
  CodexAppServerFileSystemSpecialPath,
  CodexAppServerLegacyParsedCommand,
  CodexAppServerMcpElicitationPrimitiveSchema,
  CodexAppServerMcpServerElicitationRequestParams,
  CodexAppServerModel,
  CodexAppServerModelListResponse,
  CodexAppServerNetworkApprovalContext,
  CodexAppServerNetworkPolicyAmendment,
  CodexAppServerPermissionsRequestApprovalParams,
  CodexAppServerReasoningEffortOption,
  CodexAppServerRequestPermissionProfile,
  CodexAppServerSkillRecord,
  CodexAppServerSkillCatalogEntry,
  CodexAppServerSkillsListResponse,
  CodexAppServerThread,
  CodexAppServerThreadItem,
  CodexAppServerThreadStatus,
  CodexAppServerTurn,
  CodexAppServerTurnError,
} from "./codex-app-server-protocol-schemas";

export type CodexAppServerJsonValue = JsonValue;

export type CodexAppServerRequestId = number | string;
export type CodexAppServerAbsolutePath = string;
export type CodexAppServerReasoningEffort = CodexAppServerRequestReasoningEffort;
export type CodexAppServerReasoningSummary = "auto" | "concise" | "detailed" | "none";
export type CodexAppServerPersonality = "friendly" | "none" | "pragmatic";
export type CodexAppServerSortDirection = "asc" | "desc";
export type CodexAppServerTurnItemsView = "full" | "notLoaded" | "summary";
export type CodexAppServerThreadActiveFlag = Extract<
  CodexAppServerThreadStatus,
  { type: "active" }
>["activeFlags"][number];
export type CodexAppServerThreadSource = NonNullable<CodexAppServerThread["threadSource"]>;
export type CodexAppServerThreadStartSource = "clear" | "startup";
export type CodexAppServerSessionSource = CodexAppServerThread["source"];
export type CodexAppServerSubAgentSource = Extract<
  CodexAppServerSessionSource,
  { subAgent: object }
>["subAgent"];
export type CodexAppServerSubAgentThreadSpawnSource = Extract<
  CodexAppServerSubAgentSource,
  { thread_spawn: object }
>["thread_spawn"];
export type CodexAppServerCollabAgentToolCallThreadItem = Extract<
  CodexAppServerThreadItem,
  { type: "collabAgentToolCall" }
>;
export type CodexAppServerCollabAgentTool = CodexAppServerCollabAgentToolCallThreadItem["tool"];
export type CodexAppServerCollabAgentToolCallStatus =
  CodexAppServerCollabAgentToolCallThreadItem["status"];
export type CodexAppServerCollabAgentState =
  CodexAppServerCollabAgentToolCallThreadItem["agentsStates"][string];
export type CodexAppServerCollabAgentStatus = CodexAppServerCollabAgentState["status"];
export type CodexAppServerSubAgentActivityThreadItem = Extract<
  CodexAppServerThreadItem,
  { type: "subAgentActivity" }
>;
export type CodexAppServerSubAgentActivityKind = CodexAppServerSubAgentActivityThreadItem["kind"];
export type CodexAppServerSubagentThreadItem =
  | CodexAppServerCollabAgentToolCallThreadItem
  | CodexAppServerSubAgentActivityThreadItem;
export type CodexAppServerHookPromptFragment = Extract<
  CodexAppServerThreadItem,
  { type: "hookPrompt" }
>["fragments"][number];
export type CodexAppServerMemoryCitation = NonNullable<
  Extract<CodexAppServerThreadItem, { type: "agentMessage" }>["memoryCitation"]
>;
export type CodexAppServerMemoryCitationEntry = CodexAppServerMemoryCitation["entries"][number];
export type CodexAppServerFileUpdateChange = Extract<
  CodexAppServerThreadItem,
  { type: "fileChange" }
>["changes"][number];
export type CodexAppServerPatchChangeKind = CodexAppServerFileUpdateChange["kind"];
type CodexAppServerMcpToolCallThreadItem = Extract<
  CodexAppServerThreadItem,
  { type: "mcpToolCall" }
>;
export type CodexAppServerMcpToolCallAppContext = NonNullable<
  CodexAppServerMcpToolCallThreadItem["appContext"]
>;
export type CodexAppServerMcpToolCallResult = NonNullable<
  CodexAppServerMcpToolCallThreadItem["result"]
>;
export type CodexAppServerDynamicToolCallOutputContentItem = NonNullable<
  Extract<CodexAppServerThreadItem, { type: "dynamicToolCall" }>["contentItems"]
>[number];
export type CodexAppServerWebSearchAction = NonNullable<
  Extract<CodexAppServerThreadItem, { type: "webSearch" }>["action"]
>;
export type CodexAppServerSandboxMode = "danger-full-access" | "read-only" | "workspace-write";

export type CodexAppServerInitializeParams = CodexAppServerRequestParamsMap["initialize"];
export type CodexAppServerClientInfo = CodexAppServerInitializeParams["clientInfo"];
export type CodexAppServerInitializeCapabilities = NonNullable<
  CodexAppServerInitializeParams["capabilities"]
>;
export type CodexAppServerInitializeResponse = CodexAppServerRequestResultMap["initialize"];
export type CodexAppServerClientNotification = { method: "initialized" };

export type CodexAppServerThreadExtra = Record<string, never>;
export type CodexAppServerThreadSection = NonNullable<CodexAppServerThread["section"]>;
export type CodexAppServerThreadSectionAppearance = NonNullable<
  CodexAppServerThreadSection["appearance"]
>;
export type CodexAppServerGitInfo = NonNullable<CodexAppServerThread["gitInfo"]>;
export type CodexAppServerThreadHistoryMode = "legacy" | "paginated";
export type CodexAppServerThreadStartParams = CodexAppServerRequestParamsMap["thread/start"];
export type CodexAppServerAskForApproval = NonNullable<
  CodexAppServerThreadStartParams["approvalPolicy"]
>;
export type CodexAppServerApprovalsReviewer = NonNullable<
  CodexAppServerThreadStartParams["approvalsReviewer"]
>;
export type CodexAppServerSandboxPolicy = NonNullable<
  CodexAppServerRequestParamsMap["turn/start"]["sandboxPolicy"]
>;
export type CodexAppServerMultiAgentMode = NonNullable<
  CodexAppServerThreadStartParams["multiAgentMode"]
>;
export type CodexAppServerTurnEnvironmentParams = NonNullable<
  CodexAppServerThreadStartParams["environments"]
>[number];
export type CodexAppServerDynamicToolSpec = NonNullable<
  CodexAppServerThreadStartParams["dynamicTools"]
>[number];
export type CodexAppServerDynamicToolFunctionSpec = Omit<
  Extract<CodexAppServerDynamicToolSpec, { type: "function" }>,
  "type"
>;
export type CodexAppServerSelectedCapabilityRoot = NonNullable<
  CodexAppServerThreadStartParams["selectedCapabilityRoots"]
>[number];
export type CodexAppServerThreadResumeParams = CodexAppServerRequestParamsMap["thread/resume"];
export type CodexAppServerThreadForkParams = CodexAppServerRequestParamsMap["thread/fork"];
export type CodexAppServerThreadSetNameParams = CodexAppServerRequestParamsMap["thread/name/set"];
export type CodexAppServerThreadSetNameResult = CodexAppServerRequestResultMap["thread/name/set"];
export type CodexAppServerThreadCompactStartParams =
  CodexAppServerRequestParamsMap["thread/compact/start"];
export type CodexAppServerThreadCompactStartResult =
  CodexAppServerRequestResultMap["thread/compact/start"];
export type CodexAppServerActivePermissionProfile = NonNullable<
  CodexAppServerRequestResultMap["thread/start"]["activePermissionProfile"]
>;
export type CodexAppServerTurnsPage = NonNullable<
  CodexAppServerRequestResultMap["thread/resume"]["initialTurnsPage"]
>;
export type CodexAppServerThreadStartResult = CodexAppServerRequestResultMap["thread/start"];
export type CodexAppServerThreadResumeResult = CodexAppServerRequestResultMap["thread/resume"];
export type CodexAppServerThreadForkResult = CodexAppServerRequestResultMap["thread/fork"];

export type CodexAppServerThreadListParams = CodexAppServerRequestParamsMap["thread/list"];
export type CodexAppServerThreadListResponse = CodexAppServerRequestResultMap["thread/list"];
export type CodexAppServerThreadLoadedListParams =
  CodexAppServerRequestParamsMap["thread/loaded/list"];
export type CodexAppServerThreadLoadedListResponse =
  CodexAppServerRequestResultMap["thread/loaded/list"];
export type CodexAppServerThreadReadParams = CodexAppServerRequestParamsMap["thread/read"];
export type CodexAppServerThreadReadResponse = CodexAppServerRequestResultMap["thread/read"];
export type CodexAppServerThreadTurnsListParams =
  CodexAppServerRequestParamsMap["thread/turns/list"];
export type CodexAppServerThreadTurnsListResponse =
  CodexAppServerRequestResultMap["thread/turns/list"];

export type CodexAppServerSkillsListParams = CodexAppServerRequestParamsMap["skills/list"];

export type CodexAppServerTurnStartParams = CodexAppServerRequestParamsMap["turn/start"];
export type CodexAppServerUserInput = CodexAppServerTurnStartParams["input"][number];
export type CodexAppServerTurnStartResult = CodexAppServerRequestResultMap["turn/start"];
export type CodexAppServerTurnSteerParams = CodexAppServerRequestParamsMap["turn/steer"];
export type CodexAppServerTurnSteerResult = CodexAppServerRequestResultMap["turn/steer"];
export type CodexAppServerTurnInterruptParams = CodexAppServerRequestParamsMap["turn/interrupt"];
export type CodexAppServerTurnInterruptResult = CodexAppServerRequestResultMap["turn/interrupt"];

export type CodexAppServerModelListParams = CodexAppServerRequestParamsMap["model/list"];

export type CodexAppServerGitDiffToRemoteParams = CodexAppServerRequestParamsMap["gitDiffToRemote"];
export type CodexAppServerGitDiffToRemoteResponse =
  CodexAppServerRequestResultMap["gitDiffToRemote"];

export type CodexAppServerFuzzyFileSearchParams = CodexAppServerRequestParamsMap["fuzzyFileSearch"];
export type CodexAppServerFuzzyFileSearchResponse =
  CodexAppServerRequestResultMap["fuzzyFileSearch"];
export type CodexAppServerFuzzyFileSearchResult =
  CodexAppServerFuzzyFileSearchResponse["files"][number];
export type CodexAppServerFuzzyFileSearchMatchType =
  CodexAppServerFuzzyFileSearchResult["match_type"];

export type CodexAppServerThreadTokenUsageUpdatedNotification = {
  threadId: string;
  tokenUsage: {
    last: CodexAppServerTokenUsageBreakdown;
    modelContextWindow: number | null;
    total: CodexAppServerTokenUsageBreakdown;
  };
  turnId: string;
};
export type CodexAppServerTokenUsageBreakdown = {
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};
export type CodexAppServerThreadStatusChangedNotification = {
  status: CodexAppServerThreadStatus;
  threadId: string;
};

export const CODEX_APP_SERVER_SERVER_NOTIFICATION_METHODS = [
  "error",
  "thread/started",
  "thread/status/changed",
  "thread/archived",
  "thread/deleted",
  "thread/unarchived",
  "thread/closed",
  "thread/reverted",
  "skills/changed",
  "thread/name/updated",
  "thread/goal/updated",
  "thread/goal/cleared",
  "thread/queue/changed",
  "project/changed",
  "thread/project/updated",
  "thread/environment/connected",
  "thread/environment/disconnected",
  "thread/settings/updated",
  "thread/tokenUsage/updated",
  "turn/started",
  "hook/started",
  "turn/completed",
  "hook/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "item/started",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "item/completed",
  "rawResponseItem/completed",
  "rawResponse/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "command/exec/outputDelta",
  "process/outputDelta",
  "process/exited",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "serverRequest/resolved",
  "item/mcpToolCall/progress",
  "mcpServer/oauthLogin/completed",
  "mcpServer/startupStatus/updated",
  "account/updated",
  "account/rateLimits/updated",
  "app/list/updated",
  "remoteControl/status/changed",
  "externalAgentConfig/import/progress",
  "externalAgentConfig/import/completed",
  "fs/changed",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "thread/compacted",
  "model/rerouted",
  "model/verification",
  "turn/moderationMetadata",
  "model/safetyBuffering/updated",
  "warning",
  "guardianWarning",
  "deprecationNotice",
  "configWarning",
  "fuzzyFileSearch/sessionUpdated",
  "fuzzyFileSearch/sessionCompleted",
  "thread/realtime/started",
  "thread/realtime/itemAdded",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/error",
  "thread/realtime/closed",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
  "account/login/completed",
] as const;

export type CodexAppServerServerNotificationMethod =
  (typeof CODEX_APP_SERVER_SERVER_NOTIFICATION_METHODS)[number];

export type CodexAppServerServerNotification = {
  id?: never;
  // Notifications are additive, so the wire shape stays open while known methods remain typed above.
  method: string;
  params: CodexAppServerJsonValue;
};

export type CodexAppServerExecCommandApprovalResponse = {
  decision: CodexAppServerReviewDecision;
};
export type CodexAppServerReviewDecision =
  | "approved"
  | "approved_for_session"
  | "approved_mcp_policy_amendment"
  | "timed_out"
  | "abort"
  | { approved_execpolicy_amendment: { proposed_execpolicy_amendment: string[] } }
  | { network_policy_amendment: { network_policy_amendment: CodexAppServerNetworkPolicyAmendment } }
  | { denied: { rejection: string } };
export type CodexAppServerCommandExecutionApprovalResponse = {
  decision: CodexAppServerCommandExecutionApprovalDecision;
};
export type CodexAppServerFileChangeApprovalResponse = {
  decision: "accept" | "acceptForSession" | "decline" | "cancel";
};
export type CodexAppServerGrantedPermissionProfile = {
  network?: CodexAppServerAdditionalNetworkPermissions;
  fileSystem?: CodexAppServerAdditionalFileSystemPermissions;
};
export type CodexAppServerPermissionsApprovalResponse = {
  permissions: CodexAppServerGrantedPermissionProfile;
  scope: "turn" | "session";
  strictAutoReview?: boolean;
};
export type CodexAppServerMcpServerElicitationAction = "accept" | "decline" | "cancel";
export type CodexAppServerMcpServerElicitationRequestResponse = {
  action: CodexAppServerMcpServerElicitationAction;
  content: CodexAppServerJsonValue | null;
  _meta: CodexAppServerJsonValue | null;
};
export type CodexAppServerToolRequestUserInputResponse = {
  answers: { [key in string]?: { answers: string[] } };
};
export type CodexAppServerDynamicToolCallResponse = {
  contentItems: CodexAppServerDynamicToolCallOutputContentItem[];
  success: boolean;
};
export type CodexAppServerChatgptAuthTokensRefreshResponse = {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType: string | null;
};
export type CodexAppServerAttestationGenerateResponse = {
  token: string;
};
export {
  codexAppServerCommandActionSchema,
  codexAppServerCommandExecutionRequestApprovalParamsSchema,
  codexAppServerCurrentTimeReadParamsSchema,
  codexAppServerCurrentTimeReadResponseSchema,
  codexAppServerExecCommandApprovalParamsSchema,
  codexAppServerLegacyParsedCommandSchema,
  codexAppServerMcpServerElicitationRequestParamsSchema,
  codexAppServerPermissionsRequestApprovalParamsSchema,
  codexAppServerRequestPermissionProfileSchema,
  codexAppServerTurnSchema,
} from "./codex-app-server-protocol-schemas";

export const CODEX_APP_SERVER_SERVER_REQUEST_METHOD = {
  ACCOUNT_CHATGPT_AUTH_TOKENS_REFRESH: "account/chatgptAuthTokens/refresh",
  APPLY_PATCH_APPROVAL: "applyPatchApproval",
  ATTESTATION_GENERATE: "attestation/generate",
  CURRENT_TIME_READ: "currentTime/read",
  EXEC_COMMAND_APPROVAL: "execCommandApproval",
  ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL: "item/commandExecution/requestApproval",
  ITEM_FILE_CHANGE_REQUEST_APPROVAL: "item/fileChange/requestApproval",
  ITEM_PERMISSIONS_REQUEST_APPROVAL: "item/permissions/requestApproval",
  ITEM_TOOL_CALL: "item/tool/call",
  ITEM_TOOL_REQUEST_USER_INPUT: "item/tool/requestUserInput",
  MCP_SERVER_ELICITATION_REQUEST: "mcpServer/elicitation/request",
} as const;

export type CodexAppServerServerRequestMethod =
  (typeof CODEX_APP_SERVER_SERVER_REQUEST_METHOD)[keyof typeof CODEX_APP_SERVER_SERVER_REQUEST_METHOD];

export const CODEX_APP_SERVER_SERVER_REQUEST_METHODS = [
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ACCOUNT_CHATGPT_AUTH_TOKENS_REFRESH,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.APPLY_PATCH_APPROVAL,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ATTESTATION_GENERATE,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.CURRENT_TIME_READ,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_FILE_CHANGE_REQUEST_APPROVAL,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_TOOL_CALL,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_TOOL_REQUEST_USER_INPUT,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST,
] as const satisfies readonly CodexAppServerServerRequestMethod[];

export const CODEX_APP_SERVER_FILE_MUTATION_REQUEST_METHODS = [
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.APPLY_PATCH_APPROVAL,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_FILE_CHANGE_REQUEST_APPROVAL,
] as const satisfies readonly CodexAppServerServerRequestMethod[];

export type CodexAppServerFileMutationRequestMethod =
  (typeof CODEX_APP_SERVER_FILE_MUTATION_REQUEST_METHODS)[number];

export const isCodexAppServerFileMutationRequestMethod = (
  method: string,
): method is CodexAppServerFileMutationRequestMethod =>
  CODEX_APP_SERVER_FILE_MUTATION_REQUEST_METHODS.some((candidate) => candidate === method);

export const CODEX_APP_SERVER_COMMAND_REQUEST_METHODS = [
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
] as const satisfies readonly CodexAppServerServerRequestMethod[];

export type CodexAppServerCommandRequestMethod =
  (typeof CODEX_APP_SERVER_COMMAND_REQUEST_METHODS)[number];

export const isCodexAppServerCommandRequestMethod = (
  method: string,
): method is CodexAppServerCommandRequestMethod =>
  CODEX_APP_SERVER_COMMAND_REQUEST_METHODS.some((candidate) => candidate === method);

export const CODEX_APP_SERVER_PERMISSION_REQUEST_METHODS = [
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
] as const satisfies readonly CodexAppServerServerRequestMethod[];

export type CodexAppServerPermissionRequestMethod =
  (typeof CODEX_APP_SERVER_PERMISSION_REQUEST_METHODS)[number];

export const isCodexAppServerPermissionRequestMethod = (
  method: string,
): method is CodexAppServerPermissionRequestMethod =>
  CODEX_APP_SERVER_PERMISSION_REQUEST_METHODS.some((candidate) => candidate === method);

export type CodexAppServerServerRequest = CodexAppServerWireServerRequest;
export type CodexAppServerProtocolMessage =
  | CodexAppServerServerNotification
  | CodexAppServerServerRequest;

export type CodexAppServerClientRequestMap = {
  [Method in keyof CodexAppServerRequestResultMap]: {
    params: CodexAppServerRequestParamsMap[Method];
    result: CodexAppServerRequestResultMap[Method];
  };
};
export type CodexAppServerRequestMethod = keyof CodexAppServerClientRequestMap;
export type CodexAppServerRequestParams<
  Method extends CodexAppServerRequestMethod = CodexAppServerRequestMethod,
> = CodexAppServerClientRequestMap[Method]["params"];
export type CodexAppServerClientRequest = CodexAppServerParsedClientRequest;
export type CodexAppServerRequestResult =
  CodexAppServerClientRequestMap[CodexAppServerRequestMethod]["result"];

export type CodexAppServerRespondResult =
  | CodexAppServerCommandExecutionApprovalResponse
  | CodexAppServerCurrentTimeReadResponse
  | CodexAppServerExecCommandApprovalResponse
  | CodexAppServerFileChangeApprovalResponse
  | CodexAppServerMcpServerElicitationRequestResponse
  | CodexAppServerPermissionsApprovalResponse
  | CodexAppServerToolRequestUserInputResponse
  | CodexAppServerDynamicToolCallResponse
  | CodexAppServerChatgptAuthTokensRefreshResponse
  | CodexAppServerAttestationGenerateResponse;
export type CodexAppServerRespondError = {
  code: number;
  data?: CodexAppServerJsonValue;
  message: string;
};
