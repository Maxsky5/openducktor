// Source-grounded Codex app-server protocol facade.
// Reference schema:
// https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/typescript

import { parseCodexAppServerClientRequest as parseClientRequest } from "./codex-app-server-request-schemas";
import type {
  CodexAppServerParsedClientRequest,
  CodexAppServerRequestParamsMap,
  CodexAppServerRequestReasoningEffort,
} from "./codex-app-server-request-schemas";
import { parseCodexAppServerRequestResultValue } from "./codex-app-server-protocol-schemas";
import type { JsonValue } from "./json-types";
import type { CodexAppServerWireServerRequest } from "./codex-app-server-runtime-schemas";

export {
  codexAppServerClientRequestSchema,
  codexAppServerReasoningEffortSchema,
  codexAppServerRequestParamsSchemas,
} from "./codex-app-server-request-schemas";
export { codexAppServerRequestResultSchema } from "./codex-app-server-protocol-schemas";

export type CodexAppServerJsonValue = JsonValue;

export type CodexAppServerRequestId = number | string;
export type CodexAppServerAbsolutePath = string;
export type CodexAppServerReasoningEffort = CodexAppServerRequestReasoningEffort;
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
export type CodexAppServerThreadSource = string;
export type CodexAppServerThreadStartSource = "clear" | "startup";
export type CodexAppServerSubAgentThreadSpawnSource = {
  parent_thread_id: string;
  depth: number;
  agent_path: string | null;
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
  type: "collabAgentToolCall";
  id: string;
  tool: CodexAppServerCollabAgentTool;
  status: CodexAppServerCollabAgentToolCallStatus;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: CodexAppServerReasoningEffort | null;
  agentsStates: { [key in string]?: CodexAppServerCollabAgentState };
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
export type CodexAppServerHookPromptFragment = {
  text: string;
  hookRunId: string;
};
export type CodexAppServerMemoryCitationEntry = {
  path: string;
  lineStart: number;
  lineEnd: number;
  note: string;
};
export type CodexAppServerMemoryCitation = {
  entries: CodexAppServerMemoryCitationEntry[];
  threadIds: string[];
};
export type CodexAppServerPatchChangeKind =
  | { type: "add" }
  | { type: "delete" }
  | { type: "update"; move_path: string | null };
export type CodexAppServerFileUpdateChange = {
  path: string;
  kind: CodexAppServerPatchChangeKind;
  diff: string;
};
export type CodexAppServerMcpToolCallAppContext = {
  connectorId: string;
  linkId: string | null;
  resourceUri: string | null;
  appName: string | null;
  actionName: string | null;
};
export type CodexAppServerMcpToolCallResult = {
  content: CodexAppServerJsonValue[];
  structuredContent: CodexAppServerJsonValue | null;
  _meta: CodexAppServerJsonValue | null;
};
export type CodexAppServerDynamicToolCallOutputContentItem =
  | { type: "inputText"; text: string }
  | { type: "inputImage"; imageUrl: string }
  | { type: "inputAudio"; audioUrl: string };
export type CodexAppServerWebSearchAction =
  | { type: "search"; query: string | null; queries: string[] | null }
  | { type: "openPage"; url: string | null }
  | { type: "findInPage"; url: string | null; pattern: string | null }
  | { type: "other" };
export type CodexAppServerThreadItem =
  | {
      type: "userMessage";
      id: string;
      clientId: string | null;
      content: CodexAppServerUserInput[];
    }
  | { type: "hookPrompt"; id: string; fragments: CodexAppServerHookPromptFragment[] }
  | {
      type: "agentMessage";
      id: string;
      text: string;
      phase: "commentary" | "final_answer" | null;
      memoryCitation: CodexAppServerMemoryCitation | null;
    }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | {
      type: "commandExecution";
      id: string;
      pluginId: string | null;
      scriptPath: string | null;
      command: string;
      cwd: string;
      processId: string | null;
      source: "agent" | "userShell" | "unifiedExecStartup" | "unifiedExecInteraction";
      status: "inProgress" | "completed" | "failed" | "declined";
      commandActions: CodexAppServerCommandAction[];
      aggregatedOutput: string | null;
      exitCode: number | null;
      durationMs: number | null;
    }
  | {
      type: "fileChange";
      id: string;
      changes: CodexAppServerFileUpdateChange[];
      status: "inProgress" | "completed" | "failed" | "declined";
    }
  | {
      type: "mcpToolCall";
      id: string;
      server: string;
      tool: string;
      status: "inProgress" | "completed" | "failed";
      arguments: CodexAppServerJsonValue;
      appContext: CodexAppServerMcpToolCallAppContext | null;
      mcpAppResourceUri?: string | undefined;
      pluginId: string | null;
      readOnlyHint: boolean | null;
      result: CodexAppServerMcpToolCallResult | null;
      error: { message: string } | null;
      durationMs: number | null;
    }
  | {
      type: "dynamicToolCall";
      id: string;
      namespace: string | null;
      tool: string;
      arguments: CodexAppServerJsonValue;
      status: "inProgress" | "completed" | "failed";
      contentItems: CodexAppServerDynamicToolCallOutputContentItem[] | null;
      success: boolean | null;
      durationMs: number | null;
    }
  | CodexAppServerCollabAgentToolCallThreadItem
  | CodexAppServerSubAgentActivityThreadItem
  | {
      type: "webSearch";
      id: string;
      query: string;
      action: CodexAppServerWebSearchAction | null;
      results: CodexAppServerJsonValue[] | null;
    }
  | { type: "imageView"; id: string; path: string }
  | { type: "sleep"; id: string; durationMs: number }
  | {
      type: "imageGeneration";
      id: string;
      status: string;
      revisedPrompt: string | null;
      result: string;
      transparentBackground?: boolean | undefined;
      failure: { type: "usageLimitExceeded"; limitId: string; resetsAt: number | null } | null;
      savedPath?: string | undefined;
    }
  | { type: "enteredReviewMode"; id: string; review: string }
  | { type: "exitedReviewMode"; id: string; review: string }
  | { type: "contextCompaction"; id: string };
export type CodexAppServerAskForApproval =
  | "never"
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
  | { type: "externalSandbox"; networkAccess: "enabled" | "restricted" }
  | { type: "readOnly"; networkAccess: boolean }
  | {
      type: "workspaceWrite";
      excludeSlashTmp: boolean;
      excludeTmpdirEnvVar: boolean;
      networkAccess: boolean;
      writableRoots: CodexAppServerAbsolutePath[];
    };

export type CodexAppServerInitializeParams = CodexAppServerRequestParamsMap["initialize"];
export type CodexAppServerClientInfo = CodexAppServerInitializeParams["clientInfo"];
export type CodexAppServerInitializeCapabilities = NonNullable<
  CodexAppServerInitializeParams["capabilities"]
>;
export type CodexAppServerInitializeResponse = {
  codexHome: CodexAppServerAbsolutePath;
  platformFamily: string;
  platformOs: string;
  userAgent: string;
};
export type CodexAppServerClientNotification = { method: "initialized" };

export type CodexAppServerThreadExtra = Record<string, never>;
export type CodexAppServerThreadSectionAppearance = {
  icon: string | null;
  color: string | null;
};
export type CodexAppServerThreadSection = {
  id: string;
  name: string;
  appearance: CodexAppServerThreadSectionAppearance | null;
};
export type CodexAppServerGitInfo = {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
};
export type CodexAppServerThreadHistoryMode = "legacy" | "paginated";
export type CodexAppServerThread = {
  id: string;
  extra: CodexAppServerThreadExtra | null;
  sessionId: string;
  forkedFromId: string | null;
  parentThreadId: string | null;
  preview: string;
  ephemeral: boolean;
  section: CodexAppServerThreadSection | null;
  sectionEnteredAt: number | null;
  projectId: string | null;
  historyMode: CodexAppServerThreadHistoryMode;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: CodexAppServerThreadStatus;
  path: string | null;
  cwd: CodexAppServerAbsolutePath;
  cliVersion: string;
  source: CodexAppServerSessionSource;
  canAcceptDirectInput: boolean | null;
  threadSource: CodexAppServerThreadSource | null;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: CodexAppServerGitInfo | null;
  name: string | null;
  turns: CodexAppServerTurn[];
};
export type CodexAppServerTurn = {
  completedAt: number | null;
  durationMs: number | null;
  error: CodexAppServerTurnError | null;
  id: string;
  items: CodexAppServerThreadItem[];
  itemsView: CodexAppServerTurnItemsView;
  startedAt: number | null;
  status: "completed" | "interrupted" | "failed" | "inProgress";
};
export type CodexAppServerCodexErrorInfo =
  | "contextWindowExceeded"
  | "sessionBudgetExceeded"
  | "usageLimitExceeded"
  | "serverOverloaded"
  | "cyberPolicy"
  | "misalignmentPolicyViolation"
  | "internalServerError"
  | "unauthorized"
  | "badRequest"
  | "threadRollbackFailed"
  | "sandboxError"
  | "other"
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } }
  | { activeTurnNotSteerable: { turnKind: "review" | "compact" } };
export type CodexAppServerTurnError = {
  message: string;
  codexErrorInfo: CodexAppServerCodexErrorInfo | null;
  additionalDetails: string | null;
};

export type CodexAppServerThreadStartParams = CodexAppServerRequestParamsMap["thread/start"];
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
export type CodexAppServerThreadSetNameResult = Record<string, never>;
export type CodexAppServerThreadCompactStartParams =
  CodexAppServerRequestParamsMap["thread/compact/start"];
export type CodexAppServerThreadCompactStartResult = Record<string, never>;
export type CodexAppServerActivePermissionProfile = {
  id: string;
  extends: string | null;
};
export type CodexAppServerTurnsPage = {
  data: CodexAppServerTurn[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};
type CodexAppServerThreadLaunchResult = {
  approvalPolicy: CodexAppServerAskForApproval;
  approvalsReviewer: CodexAppServerApprovalsReviewer;
  activePermissionProfile: CodexAppServerActivePermissionProfile | null;
  cwd: CodexAppServerAbsolutePath;
  instructionSources: CodexAppServerAbsolutePath[];
  model: string;
  modelProvider: string;
  multiAgentMode: CodexAppServerMultiAgentMode;
  reasoningEffort: CodexAppServerReasoningEffort | null;
  runtimeWorkspaceRoots: CodexAppServerAbsolutePath[];
  sandbox: CodexAppServerSandboxPolicy;
  serviceTier: string | null;
  thread: CodexAppServerThread;
};
export type CodexAppServerThreadStartResult = CodexAppServerThreadLaunchResult;
export type CodexAppServerThreadResumeResult = CodexAppServerThreadLaunchResult & {
  initialTurnsPage: CodexAppServerTurnsPage | null;
  turnsBackwardsCursor: string | null;
  itemsBackwardsCursor: string | null;
};
export type CodexAppServerThreadForkResult = CodexAppServerThreadLaunchResult;

export type CodexAppServerThreadListParams = CodexAppServerRequestParamsMap["thread/list"];
export type CodexAppServerThreadListResponse = {
  backwardsCursor: string | null;
  data: CodexAppServerThread[];
  nextCursor: string | null;
};
export type CodexAppServerThreadLoadedListParams =
  CodexAppServerRequestParamsMap["thread/loaded/list"];
export type CodexAppServerThreadLoadedListResponse = {
  data: string[];
  nextCursor: string | null;
};
export type CodexAppServerThreadReadParams = CodexAppServerRequestParamsMap["thread/read"];
export type CodexAppServerThreadReadResponse = {
  thread: CodexAppServerThread;
};
export type CodexAppServerThreadTurnsListParams =
  CodexAppServerRequestParamsMap["thread/turns/list"];
export type CodexAppServerThreadTurnsListResponse = {
  backwardsCursor: string | null;
  data: CodexAppServerTurn[];
  nextCursor: string | null;
};

export type CodexAppServerSkillRecord = {
  name: string;
  path: string;
  scope: "user" | "repo" | "system" | "admin";
  description: string;
  shortDescription?: string | undefined;
  interface?:
    | {
        displayName?: string | undefined;
        shortDescription?: string | undefined;
        iconSmall?: string | undefined;
        iconLarge?: string | undefined;
        iconSmallUrl: string | null;
        iconLargeUrl: string | null;
        brandColor?: string | undefined;
        defaultPrompt?: string | undefined;
      }
    | undefined;
  dependencies?:
    | {
        tools: Array<{
          type: string;
          value: string;
          description?: string | undefined;
          transport?: string | undefined;
          command?: string | undefined;
          url?: string | undefined;
        }>;
      }
    | undefined;
  enabled: boolean;
};
export type CodexAppServerSkillCatalogEntry = {
  cwd: string;
  skills: CodexAppServerSkillRecord[];
  errors: Array<{ path: string; message: string }>;
};
export type CodexAppServerSkillsListParams = CodexAppServerRequestParamsMap["skills/list"];
export type CodexAppServerSkillsListResponse = {
  data: CodexAppServerSkillCatalogEntry[];
};

export type CodexAppServerTurnStartParams = CodexAppServerRequestParamsMap["turn/start"];
export type CodexAppServerUserInput = CodexAppServerTurnStartParams["input"][number];
export type CodexAppServerTurnStartResult = {
  turn: CodexAppServerTurn;
};
export type CodexAppServerTurnSteerParams = CodexAppServerRequestParamsMap["turn/steer"];
export type CodexAppServerTurnSteerResult = {
  turnId: string;
};
export type CodexAppServerTurnInterruptParams = CodexAppServerRequestParamsMap["turn/interrupt"];
export type CodexAppServerTurnInterruptResult = Record<string, never>;

export type CodexAppServerReasoningEffortOption = {
  description: string;
  reasoningEffort: CodexAppServerReasoningEffort;
};
export type CodexAppServerModel = {
  additionalSpeedTiers: string[];
  availabilityNux: { message: string } | null;
  defaultReasoningEffort: CodexAppServerReasoningEffort;
  defaultServiceTier: string | null;
  description: string;
  displayName: string;
  hidden: boolean;
  id: string;
  inputModalities: Array<"text" | "image" | "audio">;
  isDefault: boolean;
  model: string;
  modelSpecialty: string | null;
  multiAgentVersion: "disabled" | "v1" | "v2" | null;
  serviceTiers: Array<{ id: string; name: string; description: string }>;
  supportedReasoningEfforts: CodexAppServerReasoningEffortOption[];
  supportsPersonality: boolean;
  upgrade: string | null;
  upgradeInfo: {
    model: string;
    upgradeCopy: string | null;
    modelLink: string | null;
    migrationMarkdown: string | null;
    retirementAt: number | null;
  } | null;
};
export type CodexAppServerModelListParams = CodexAppServerRequestParamsMap["model/list"];
export type CodexAppServerModelListResponse = {
  data: CodexAppServerModel[];
  nextCursor: string | null;
};

export type CodexAppServerGitDiffToRemoteParams = CodexAppServerRequestParamsMap["gitDiffToRemote"];
export type CodexAppServerGitDiffToRemoteResponse = {
  diff: string;
  sha: string;
};

export type CodexAppServerFuzzyFileSearchMatchType = "file" | "directory";
export type CodexAppServerFuzzyFileSearchParams = CodexAppServerRequestParamsMap["fuzzyFileSearch"];
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
export type CodexAppServerNetworkApprovalContext = {
  host: string;
  protocol: "http" | "https" | "socks5Tcp" | "socks5Udp";
};
export type CodexAppServerNetworkPolicyAmendment = {
  host: string;
  action: "allow" | "deny";
};
export type CodexAppServerCommandExecutionRequestApprovalParams = {
  additionalPermissions?: CodexAppServerRequestPermissionProfile | null;
  approvalId?: string | null;
  command?: string | null;
  commandActions?: CodexAppServerCommandAction[] | null;
  cwd?: CodexAppServerAbsolutePath | null;
  environmentId: string | null;
  itemId: string;
  networkApprovalContext?: CodexAppServerNetworkApprovalContext | null;
  reason?: string | null;
  startedAtMs: number;
  threadId: string;
  turnId: string;
  proposedExecpolicyAmendment?: string[] | null;
  proposedNetworkPolicyAmendments?: CodexAppServerNetworkPolicyAmendment[] | null;
  availableDecisions?: CodexAppServerCommandExecutionApprovalDecision[] | null;
};
export type CodexAppServerCommandExecutionApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] } }
  | {
      applyNetworkPolicyAmendment: {
        network_policy_amendment: CodexAppServerNetworkPolicyAmendment;
      };
    };
export type CodexAppServerCommandExecutionApprovalResponse = {
  decision: CodexAppServerCommandExecutionApprovalDecision;
};
export type CodexAppServerFileChangeApprovalResponse = {
  decision: "accept" | "acceptForSession" | "decline" | "cancel";
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
  environmentId: string | null;
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
type CodexAppServerMcpElicitationSchemaDescription = {
  title?: string;
  description?: string;
};
type CodexAppServerMcpElicitationConstOption = {
  const: string;
  title: string;
};
export type CodexAppServerMcpElicitationPrimitiveSchema =
  | (CodexAppServerMcpElicitationSchemaDescription & {
      type: "string";
      minLength?: number;
      maxLength?: number;
      format?: "email" | "uri" | "date" | "date-time";
      default?: string;
    })
  | (CodexAppServerMcpElicitationSchemaDescription & {
      type: "number" | "integer";
      minimum?: number;
      maximum?: number;
      default?: number;
    })
  | (CodexAppServerMcpElicitationSchemaDescription & {
      type: "boolean";
      default?: boolean;
    })
  | (CodexAppServerMcpElicitationSchemaDescription & {
      type: "string";
      enum: string[];
      enumNames?: string[];
      default?: string;
    })
  | (CodexAppServerMcpElicitationSchemaDescription & {
      type: "string";
      oneOf: CodexAppServerMcpElicitationConstOption[];
      default?: string;
    })
  | (CodexAppServerMcpElicitationSchemaDescription & {
      type: "array";
      minItems?: number;
      maxItems?: number;
      items:
        | { type: "string"; enum: string[] }
        | { anyOf: CodexAppServerMcpElicitationConstOption[] };
      default?: string[];
    });
export type CodexAppServerMcpServerElicitationRequestParams = {
  threadId: string;
  turnId: string | null;
  serverName: string;
} & (
  | {
      mode: "form";
      _meta: CodexAppServerJsonValue | null;
      message: string;
      requestedSchema: {
        $schema?: string;
        type: "object";
        properties: Record<string, CodexAppServerMcpElicitationPrimitiveSchema>;
        required?: string[];
      };
    }
  | {
      mode: "openai/form";
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
export type CodexAppServerCurrentTimeReadParams = {
  threadId: string;
};
export type CodexAppServerCurrentTimeReadResponse = {
  /** Current time as whole Unix seconds. */
  currentTimeAt: number;
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

type CodexAppServerClientRequestDefinitionMap = {
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
  "thread/compact/start": {
    params: CodexAppServerThreadCompactStartParams;
    result: CodexAppServerThreadCompactStartResult;
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
export type CodexAppServerClientRequestMap = {
  [Method in keyof CodexAppServerClientRequestDefinitionMap]: {
    params: CodexAppServerRequestParamsMap[Method];
    result: CodexAppServerClientRequestDefinitionMap[Method]["result"];
  };
};
export type CodexAppServerRequestMethod = keyof CodexAppServerClientRequestMap;
export type CodexAppServerRequestParams<
  Method extends CodexAppServerRequestMethod = CodexAppServerRequestMethod,
> = CodexAppServerClientRequestMap[Method]["params"];
export type CodexAppServerClientRequest = CodexAppServerParsedClientRequest;
export type CodexAppServerRequestResult =
  CodexAppServerClientRequestMap[CodexAppServerRequestMethod]["result"];

export const parseCodexAppServerClientRequest = <Input>(
  value: Input,
): CodexAppServerClientRequest => parseClientRequest(value);

export const parseCodexAppServerRequestResult = <Method extends CodexAppServerRequestMethod, Input>(
  method: Method,
  value: Input,
): CodexAppServerClientRequestMap[Method]["result"] =>
  parseCodexAppServerRequestResultValue(method, value);

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
