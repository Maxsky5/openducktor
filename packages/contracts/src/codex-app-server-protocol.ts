// Source-grounded Codex app-server protocol facade.
// Reference schema:
// https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/typescript

export type CodexAppServerJsonValue =
  | boolean
  | null
  | number
  | string
  | CodexAppServerJsonValue[]
  | { [key in string]?: CodexAppServerJsonValue };

export type CodexAppServerRequestId = number | string;
export type CodexAppServerAbsolutePath = string;
export type CodexAppServerReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
export type CodexAppServerReasoningSummary = "auto" | "concise" | "detailed" | "none";
export type CodexAppServerPersonality = "friendly" | "none" | "pragmatic";
export type CodexAppServerSortDirection = "asc" | "desc";
export type CodexAppServerTurnItemsView = "full" | "notLoaded" | "summary";
export type CodexAppServerThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";
export type CodexAppServerThreadStatus =
  | { type: "active"; activeFlags: CodexAppServerThreadActiveFlag[] }
  | { type: "idle" }
  | { type: "notLoaded" }
  | { type: "systemError" };
export type CodexAppServerThreadSource = "memory_consolidation" | "subagent" | "user";
export type CodexAppServerThreadStartSource = "clear" | "startup";
export type CodexAppServerSubAgentThreadSpawnSource = {
  parent_thread_id: string;
  depth: number;
  agent_path: CodexAppServerJsonValue | null;
  agent_nickname: string | null;
  agent_role: string | null;
};
export type CodexAppServerSubAgentSource =
  | "review"
  | "compact"
  | "memory_consolidation"
  | { other: string }
  | { thread_spawn: CodexAppServerSubAgentThreadSpawnSource };
export type CodexAppServerSessionSource =
  | "appServer"
  | "cli"
  | "exec"
  | "unknown"
  | "vscode"
  | { custom: string }
  | { subAgent: CodexAppServerSubAgentSource };
export type CodexAppServerCollabAgentTool =
  | "spawnAgent"
  | "sendInput"
  | "resumeAgent"
  | "wait"
  | "closeAgent";
export type CodexAppServerCollabAgentToolCallStatus = "inProgress" | "completed" | "failed";
export type CodexAppServerCollabAgentStatus =
  | "pendingInit"
  | "running"
  | "interrupted"
  | "completed"
  | "errored"
  | "shutdown"
  | "notFound";
export type CodexAppServerCollabAgentState = {
  status: CodexAppServerCollabAgentStatus;
  message: string | null;
};
export type CodexAppServerCollabAgentToolCallThreadItem = {
  type: "collabAgentToolCall" | "collabToolCall";
  id: string;
  tool: CodexAppServerCollabAgentTool;
  status: CodexAppServerCollabAgentToolCallStatus;
  senderThreadId: string;
  receiverThreadIds?: string[];
  receiverThreadId?: string | null;
  newThreadId?: string | null;
  prompt?: string | null;
  model?: string | null;
  reasoningEffort?: CodexAppServerReasoningEffort | null;
  agentsStates?: { [key in string]?: CodexAppServerCollabAgentState };
  agentStatus?: CodexAppServerCollabAgentStatus | null;
};
export type CodexAppServerSubAgentActivityKind = "started" | "interacted" | "interrupted";
export type CodexAppServerSubAgentActivityThreadItem = {
  type: "subAgentActivity";
  id: string;
  kind: CodexAppServerSubAgentActivityKind;
  agentThreadId: string;
  agentPath: string;
};
export type CodexAppServerSubagentThreadItem =
  | CodexAppServerCollabAgentToolCallThreadItem
  | CodexAppServerSubAgentActivityThreadItem;
export type CodexAppServerAskForApproval =
  | "never"
  | "on-failure"
  | "on-request"
  | "untrusted"
  | {
      granular: {
        mcp_elicitations: boolean;
        request_permissions: boolean;
        rules: boolean;
        sandbox_approval: boolean;
        skill_approval: boolean;
      };
    };
export type CodexAppServerApprovalsReviewer = "auto_review" | "guardian_subagent" | "user";
export type CodexAppServerSandboxMode = "danger-full-access" | "read-only" | "workspace-write";
export type CodexAppServerSandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "externalSandbox"; networkAccess: CodexAppServerJsonValue }
  | { type: "readOnly"; networkAccess: boolean }
  | {
      type: "workspaceWrite";
      excludeSlashTmp: boolean;
      excludeTmpdirEnvVar: boolean;
      networkAccess: boolean;
      writableRoots: CodexAppServerAbsolutePath[];
    };

export type CodexAppServerClientInfo = {
  name: string;
  title: string | null;
  version: string;
};
export type CodexAppServerInitializeCapabilities = {
  experimentalApi: boolean;
  optOutNotificationMethods?: string[] | null;
  requestAttestation: boolean;
};
export type CodexAppServerInitializeParams = {
  capabilities: CodexAppServerInitializeCapabilities | null;
  clientInfo: CodexAppServerClientInfo;
};
export type CodexAppServerInitializeResponse = {
  codexHome: CodexAppServerAbsolutePath;
  platformFamily: string;
  platformOs: string;
  userAgent: string;
};
export type CodexAppServerClientNotification = { method: "initialized" };

export type CodexAppServerThread = {
  agentNickname: string | null;
  agentRole: string | null;
  cliVersion: string;
  createdAt: number;
  cwd: CodexAppServerAbsolutePath;
  ephemeral: boolean;
  forkedFromId: string | null;
  gitInfo: CodexAppServerJsonValue | null;
  id: string;
  modelProvider: string;
  name: string | null;
  parentThreadId: string | null;
  path: string | null;
  preview: string;
  sessionId: string;
  source: CodexAppServerSessionSource;
  status: CodexAppServerThreadStatus;
  threadSource: CodexAppServerThreadSource | null;
  turns: CodexAppServerTurn[];
  updatedAt: number;
};
export type CodexAppServerTurn = {
  completedAt: number | null;
  durationMs: number | null;
  error: CodexAppServerJsonValue | null;
  id: string;
  items: CodexAppServerJsonValue[];
  itemsView: CodexAppServerTurnItemsView;
  startedAt: number | null;
  status: CodexAppServerJsonValue;
};

export type CodexAppServerThreadStartParams = {
  approvalPolicy?: CodexAppServerAskForApproval | null;
  approvalsReviewer?: CodexAppServerApprovalsReviewer | null;
  baseInstructions?: string | null;
  config?: { [key in string]?: CodexAppServerJsonValue } | null;
  cwd?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean | null;
  model?: string | null;
  modelProvider?: string | null;
  personality?: CodexAppServerPersonality | null;
  sandbox?: CodexAppServerSandboxMode | null;
  serviceName?: string | null;
  serviceTier?: string | null;
  sessionStartSource?: CodexAppServerThreadStartSource | null;
  threadSource?: CodexAppServerThreadSource | null;
};
export type CodexAppServerThreadResumeParams = Omit<
  CodexAppServerThreadStartParams,
  "ephemeral" | "serviceName" | "sessionStartSource" | "threadSource"
> & {
  threadId: string;
};
export type CodexAppServerThreadForkParams = CodexAppServerThreadResumeParams & {
  ephemeral?: boolean | null;
  threadSource?: CodexAppServerThreadSource | null;
};
export type CodexAppServerThreadSetNameParams = {
  threadId: string;
  name: string;
};
export type CodexAppServerThreadSetNameResult = Record<string, never>;
export type CodexAppServerThreadStartResult = {
  approvalPolicy: CodexAppServerAskForApproval;
  approvalsReviewer: CodexAppServerApprovalsReviewer;
  cwd: CodexAppServerAbsolutePath;
  instructionSources: CodexAppServerAbsolutePath[];
  model: string;
  modelProvider: string;
  reasoningEffort: CodexAppServerReasoningEffort | null;
  sandbox: CodexAppServerSandboxPolicy;
  serviceTier: string | null;
  thread: CodexAppServerThread;
};
export type CodexAppServerThreadResumeResult = CodexAppServerThreadStartResult;
export type CodexAppServerThreadForkResult = CodexAppServerThreadStartResult;

export type CodexAppServerThreadListParams = {
  archived?: boolean | null;
  cursor?: string | null;
  cwd?: string | string[] | null;
  limit?: number | null;
  modelProviders?: string[] | null;
  searchTerm?: string | null;
  sortDirection?: CodexAppServerSortDirection | null;
  sortKey?: string | null;
  sourceKinds?: string[] | null;
  useStateDbOnly?: boolean;
};
export type CodexAppServerThreadListResponse = {
  backwardsCursor: string | null;
  data: CodexAppServerThread[];
  nextCursor: string | null;
};
export type CodexAppServerThreadLoadedListParams = {
  cursor?: string | null;
  limit?: number | null;
};
export type CodexAppServerThreadLoadedListResponse = {
  data: string[];
  nextCursor: string | null;
};
export type CodexAppServerThreadReadParams = {
  includeTurns: boolean;
  threadId: string;
};
export type CodexAppServerThreadReadResponse = {
  thread: CodexAppServerThread;
};
export type CodexAppServerThreadTurnsListParams = {
  cursor?: string | null;
  itemsView?: CodexAppServerTurnItemsView | null;
  limit?: number | null;
  sortDirection?: CodexAppServerSortDirection | null;
  threadId: string;
};
export type CodexAppServerThreadTurnsListResponse = {
  backwardsCursor: string | null;
  data: CodexAppServerTurn[];
  nextCursor: string | null;
};

export type CodexAppServerSkillRecord = {
  name: string;
  path: string;
  scope?: string | null;
  title?: string | null;
  displayName?: string | null;
  description?: string | null;
  enabled?: boolean | null;
};
export type CodexAppServerSkillCatalogEntry = {
  cwd: string;
  skills: CodexAppServerSkillRecord[];
};
export type CodexAppServerSkillsListParams = {
  cwd: string;
  forceReload?: boolean | null;
};
export type CodexAppServerSkillsListResponse = {
  data: CodexAppServerSkillCatalogEntry[];
  errors?: CodexAppServerJsonValue[] | null;
};

export type CodexAppServerUserInput =
  | { detail?: string; path: string; type: "localImage" }
  | { detail?: string; type: "image"; url: string }
  | { name: string; path: string; type: "mention" }
  | { name: string; path: string; type: "skill" }
  | { text: string; text_elements: CodexAppServerJsonValue[]; type: "text" };
export type CodexAppServerTurnStartParams = {
  approvalPolicy?: CodexAppServerAskForApproval | null;
  approvalsReviewer?: CodexAppServerApprovalsReviewer | null;
  cwd?: string | null;
  effort?: CodexAppServerReasoningEffort | null;
  input: CodexAppServerUserInput[];
  model?: string | null;
  outputSchema?: CodexAppServerJsonValue | null;
  personality?: CodexAppServerPersonality | null;
  sandboxPolicy?: CodexAppServerSandboxPolicy | null;
  serviceTier?: string | null;
  summary?: CodexAppServerReasoningSummary | null;
  threadId: string;
};
export type CodexAppServerTurnStartResult = {
  turn: CodexAppServerTurn;
};
export type CodexAppServerTurnSteerParams = {
  expectedTurnId: string;
  input: CodexAppServerUserInput[];
  threadId: string;
};
export type CodexAppServerTurnSteerResult = {
  turnId: string;
};
export type CodexAppServerTurnInterruptParams = {
  threadId: string;
  turnId: string;
};
export type CodexAppServerTurnInterruptResult = Record<string, never>;

export type CodexAppServerReasoningEffortOption = {
  description?: string | null;
  reasoningEffort: CodexAppServerReasoningEffort;
};
export type CodexAppServerModel = {
  additionalSpeedTiers: string[];
  availabilityNux: CodexAppServerJsonValue | null;
  defaultReasoningEffort: CodexAppServerReasoningEffort;
  description: string;
  displayName: string;
  hidden: boolean;
  id: string;
  inputModalities: string[];
  isDefault: boolean;
  model: string;
  serviceTiers: CodexAppServerJsonValue[];
  supportedReasoningEfforts: CodexAppServerReasoningEffortOption[];
  supportsPersonality: boolean;
  upgrade: string | null;
  upgradeInfo: CodexAppServerJsonValue | null;
};
export type CodexAppServerModelListParams = {
  cursor?: string | null;
  includeHidden?: boolean | null;
  limit?: number | null;
};
export type CodexAppServerModelListResponse = {
  data: CodexAppServerModel[];
  nextCursor: string | null;
};

export type CodexAppServerGitDiffToRemoteParams = {
  cwd: string;
};
export type CodexAppServerGitDiffToRemoteResponse = {
  diff: string;
  sha: string;
};

export type CodexAppServerFuzzyFileSearchMatchType = "file" | "directory";
export type CodexAppServerFuzzyFileSearchParams = {
  query: string;
  roots: string[];
  cancellationToken: string | null;
};
export type CodexAppServerFuzzyFileSearchResult = {
  root: string;
  path: string;
  match_type: CodexAppServerFuzzyFileSearchMatchType;
  file_name: string;
  score: number;
  indices: number[] | null;
};
export type CodexAppServerFuzzyFileSearchResponse = {
  files: CodexAppServerFuzzyFileSearchResult[];
};

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
  "account/login/completed",
  "account/rateLimits/updated",
  "account/updated",
  "app/list/updated",
  "command/exec/outputDelta",
  "configWarning",
  "deprecationNotice",
  "error",
  "externalAgentConfig/import/completed",
  "fs/changed",
  "fuzzyFileSearch/sessionCompleted",
  "fuzzyFileSearch/sessionUpdated",
  "guardianWarning",
  "hook/completed",
  "hook/started",
  "item/agentMessage/delta",
  "item/autoApprovalReview/completed",
  "item/autoApprovalReview/started",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/completed",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/mcpToolCall/progress",
  "item/plan/delta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/started",
  "mcpServer/oauthLogin/completed",
  "mcpServer/startupStatus/updated",
  "model/rerouted",
  "model/verification",
  "process/exited",
  "process/outputDelta",
  "rawResponseItem/completed",
  "remoteControl/status/changed",
  "serverRequest/resolved",
  "skills/changed",
  "thread/archived",
  "thread/closed",
  "thread/compacted",
  "thread/goal/cleared",
  "thread/goal/updated",
  "thread/name/updated",
  "thread/realtime/closed",
  "thread/realtime/error",
  "thread/realtime/itemAdded",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/started",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/settings/updated",
  "thread/started",
  "thread/status/changed",
  "thread/tokenUsage/updated",
  "thread/unarchived",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "turn/started",
  "warning",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
] as const;

export type CodexAppServerServerNotificationMethod =
  (typeof CODEX_APP_SERVER_SERVER_NOTIFICATION_METHODS)[number];

export type CodexAppServerServerNotification = {
  method: CodexAppServerServerNotificationMethod;
  params: CodexAppServerJsonValue;
};

export type CodexAppServerExecCommandApprovalParams = {
  approvalId: string | null;
  callId: string;
  command: string[];
  conversationId: string;
  cwd: string;
  parsedCmd: CodexAppServerLegacyParsedCommand[];
  reason: string | null;
};
export type CodexAppServerExecCommandApprovalResponse = {
  decision:
    | "abort"
    | "approved"
    | "approved_for_session"
    | "denied"
    | "timed_out"
    | CodexAppServerJsonValue;
};
export type CodexAppServerCommandAction =
  | { command: string; name: string; path: CodexAppServerAbsolutePath; type: "read" }
  | { command: string; path: string | null; type: "listFiles" }
  | { command: string; path: string | null; query: string | null; type: "search" }
  | { command: string; type: "unknown" };
export type CodexAppServerLegacyParsedCommand =
  | { cmd: string; name: string; path: string; type: "read" }
  | { cmd: string; path: string | null; type: "list_files" }
  | { cmd: string; path: string | null; query: string | null; type: "search" }
  | { cmd: string; type: "unknown" };
export type CodexAppServerCommandExecutionRequestApprovalParams = {
  additionalPermissions?: CodexAppServerRequestPermissionProfile | null;
  approvalId?: string | null;
  command?: string | null;
  commandActions?: CodexAppServerCommandAction[] | null;
  cwd?: CodexAppServerAbsolutePath | null;
  itemId: string;
  networkApprovalContext?: CodexAppServerJsonValue | null;
  reason?: string | null;
  startedAtMs: number;
  threadId: string;
  turnId: string;
  proposedExecpolicyAmendment?: CodexAppServerJsonValue | null;
  proposedNetworkPolicyAmendments?: CodexAppServerJsonValue[] | null;
};
export type CodexAppServerCommandExecutionApprovalResponse = {
  decision: "accept" | "acceptForSession" | "decline" | "cancel" | CodexAppServerJsonValue;
};
export type CodexAppServerAdditionalNetworkPermissions = {
  enabled: boolean | null;
};
export type CodexAppServerFileSystemSpecialPath =
  | { kind: "root" }
  | { kind: "minimal" }
  | { kind: "project_roots"; subpath: string | null }
  | { kind: "tmpdir" }
  | { kind: "slash_tmp" }
  | { kind: "unknown"; path: string; subpath: string | null };
export type CodexAppServerFileSystemPath =
  | { type: "path"; path: CodexAppServerAbsolutePath }
  | { type: "glob_pattern"; pattern: string }
  | { type: "special"; value: CodexAppServerFileSystemSpecialPath };
export type CodexAppServerFileSystemSandboxEntry = {
  path: CodexAppServerFileSystemPath;
  access: "read" | "write" | "deny";
};
export type CodexAppServerAdditionalFileSystemPermissions = {
  read: CodexAppServerAbsolutePath[] | null;
  write: CodexAppServerAbsolutePath[] | null;
  globScanMaxDepth?: number;
  entries?: CodexAppServerFileSystemSandboxEntry[];
};
export type CodexAppServerRequestPermissionProfile = {
  network: CodexAppServerAdditionalNetworkPermissions | null;
  fileSystem: CodexAppServerAdditionalFileSystemPermissions | null;
};
export type CodexAppServerGrantedPermissionProfile = {
  network?: CodexAppServerAdditionalNetworkPermissions;
  fileSystem?: CodexAppServerAdditionalFileSystemPermissions;
};
export type CodexAppServerPermissionsRequestApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  cwd: CodexAppServerAbsolutePath;
  reason: string | null;
  permissions: CodexAppServerRequestPermissionProfile;
};
export type CodexAppServerPermissionsApprovalResponse = {
  permissions: CodexAppServerGrantedPermissionProfile;
  scope: "turn" | "session";
  strictAutoReview?: boolean;
};
export type CodexAppServerMcpServerElicitationAction = "accept" | "decline" | "cancel";
export type CodexAppServerMcpServerElicitationRequestParams = {
  threadId: string;
  turnId: string | null;
  serverName: string;
} & (
  | {
      mode: "form";
      _meta: CodexAppServerJsonValue | null;
      message: string;
      requestedSchema: CodexAppServerJsonValue;
    }
  | {
      mode: "url";
      _meta: CodexAppServerJsonValue | null;
      message: string;
      url: string;
      elicitationId: string;
    }
);
export type CodexAppServerMcpServerElicitationRequestResponse = {
  action: CodexAppServerMcpServerElicitationAction;
  content: CodexAppServerJsonValue | null;
  _meta: CodexAppServerJsonValue | null;
};

export {
  isCodexAppServerCommandAction,
  isCodexAppServerLegacyParsedCommand,
  isCodexAppServerMcpServerElicitationRequestParams,
  isCodexAppServerRequestPermissionProfile,
} from "./codex-app-server-protocol-guards";

export const CODEX_APP_SERVER_SERVER_REQUEST_METHOD = {
  ACCOUNT_CHATGPT_AUTH_TOKENS_REFRESH: "account/chatgptAuthTokens/refresh",
  APPLY_PATCH_APPROVAL: "applyPatchApproval",
  ATTESTATION_GENERATE: "attestation/generate",
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

export type CodexAppServerServerRequest =
  | {
      id: CodexAppServerRequestId;
      method: "execCommandApproval";
      params: CodexAppServerExecCommandApprovalParams;
    }
  | {
      id: CodexAppServerRequestId;
      method: "item/commandExecution/requestApproval";
      params: CodexAppServerCommandExecutionRequestApprovalParams;
    }
  | {
      id: CodexAppServerRequestId;
      method: "item/permissions/requestApproval";
      params: CodexAppServerPermissionsRequestApprovalParams;
    }
  | {
      id: CodexAppServerRequestId;
      method: "mcpServer/elicitation/request";
      params: CodexAppServerMcpServerElicitationRequestParams;
    }
  | {
      id: CodexAppServerRequestId;
      method: Exclude<
        CodexAppServerServerRequestMethod,
        | "execCommandApproval"
        | "item/commandExecution/requestApproval"
        | "item/permissions/requestApproval"
        | "mcpServer/elicitation/request"
      >;
      params: CodexAppServerJsonValue;
    };
export type CodexAppServerProtocolMessage =
  | CodexAppServerServerNotification
  | CodexAppServerServerRequest;

export type CodexAppServerClientRequestMap = {
  initialize: {
    params: CodexAppServerInitializeParams;
    result: CodexAppServerInitializeResponse;
  };
  "model/list": {
    params: CodexAppServerModelListParams;
    result: CodexAppServerModelListResponse;
  };
  "thread/fork": {
    params: CodexAppServerThreadForkParams;
    result: CodexAppServerThreadForkResult;
  };
  "thread/list": {
    params: CodexAppServerThreadListParams;
    result: CodexAppServerThreadListResponse;
  };
  "thread/loaded/list": {
    params: CodexAppServerThreadLoadedListParams;
    result: CodexAppServerThreadLoadedListResponse;
  };
  "thread/read": {
    params: CodexAppServerThreadReadParams;
    result: CodexAppServerThreadReadResponse;
  };
  "thread/resume": {
    params: CodexAppServerThreadResumeParams;
    result: CodexAppServerThreadResumeResult;
  };
  "thread/start": {
    params: CodexAppServerThreadStartParams;
    result: CodexAppServerThreadStartResult;
  };
  "thread/name/set": {
    params: CodexAppServerThreadSetNameParams;
    result: CodexAppServerThreadSetNameResult;
  };
  "thread/turns/list": {
    params: CodexAppServerThreadTurnsListParams;
    result: CodexAppServerThreadTurnsListResponse;
  };
  "skills/list": {
    params: CodexAppServerSkillsListParams;
    result: CodexAppServerSkillsListResponse;
  };
  "turn/start": {
    params: CodexAppServerTurnStartParams;
    result: CodexAppServerTurnStartResult;
  };
  "turn/steer": {
    params: CodexAppServerTurnSteerParams;
    result: CodexAppServerTurnSteerResult;
  };
  "turn/interrupt": {
    params: CodexAppServerTurnInterruptParams;
    result: CodexAppServerTurnInterruptResult;
  };
  gitDiffToRemote: {
    params: CodexAppServerGitDiffToRemoteParams;
    result: CodexAppServerGitDiffToRemoteResponse;
  };
  fuzzyFileSearch: {
    params: CodexAppServerFuzzyFileSearchParams;
    result: CodexAppServerFuzzyFileSearchResponse;
  };
};
export type CodexAppServerRequestMethod = keyof CodexAppServerClientRequestMap;
export type CodexAppServerRequestParams =
  CodexAppServerClientRequestMap[CodexAppServerRequestMethod]["params"];
export type CodexAppServerClientRequest = {
  method: CodexAppServerRequestMethod;
  params?: CodexAppServerRequestParams;
};
export type CodexAppServerRequestResult =
  CodexAppServerClientRequestMap[CodexAppServerRequestMethod]["result"];

export const isCodexAppServerJsonValue = (value: unknown): value is CodexAppServerJsonValue => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isCodexAppServerJsonValue);
  }
  if (typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  return Object.values(value).every(isCodexAppServerJsonValue);
};

export const parseCodexAppServerRequestResult = (
  _method: CodexAppServerRequestMethod,
  value: unknown,
): CodexAppServerRequestResult => {
  if (!isCodexAppServerJsonValue(value)) {
    throw new TypeError("Codex app-server result must be JSON-compatible.");
  }
  return value as CodexAppServerRequestResult;
};

export type CodexAppServerRespondResult =
  | CodexAppServerCommandExecutionApprovalResponse
  | CodexAppServerExecCommandApprovalResponse
  | CodexAppServerMcpServerElicitationRequestResponse
  | CodexAppServerPermissionsApprovalResponse
  | { action: string; content?: CodexAppServerJsonValue }
  | { answers: { [key in string]?: CodexAppServerJsonValue } }
  | { content: CodexAppServerJsonValue[]; _meta?: CodexAppServerJsonValue; isError?: boolean }
  | { contentItems: CodexAppServerJsonValue[]; success: boolean }
  | { decision: "accept" | "acceptForSession" | "cancel" | "decline" | CodexAppServerJsonValue }
  | { permissions: CodexAppServerJsonValue; scope: CodexAppServerJsonValue }
  | { tokens?: CodexAppServerJsonValue };
export type CodexAppServerRespondError = {
  code: number;
  data?: CodexAppServerJsonValue;
  message: string;
};
