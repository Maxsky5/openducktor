import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerCommandExecutionApprovalDecision,
  type CodexAppServerRequestId,
  codexAppServerMcpServerElicitationRequestParamsSchema,
  isCodexAppServerCommandRequestMethod,
  isCodexAppServerFileMutationRequestMethod,
  isCodexAppServerPermissionRequestMethod,
  type RuntimeApprovalReplyOutcome,
  type RuntimeApprovalRequestType,
} from "@openducktor/contracts";
import type { AgentApprovalMutation, AgentPendingApprovalRequest } from "@openducktor/core";
import {
  CODEX_USER_INPUT_REQUEST_METHOD,
  extractStringField,
  isPlainObject,
} from "./codex-app-server-shared";
import { classifyCodexCommandRequestMutation } from "./codex-command-approvals";
import { classifyCodexPermissionRequestMutation } from "./codex-permission-approvals";
import type { CodexServerRequestRecord } from "./types";
import type { CodexAppServerJsonValue } from "@openducktor/contracts";

export { codexApprovalResponseForRequest } from "./codex-approval-responses";
export {
  parseCodexRuntimeNotificationRecord as parseNotificationRecord,
  parseCodexRuntimeServerRequestRecord as parseServerRequestRecord,
} from "./codex-runtime-event-schema";

const MCP_APPROVAL_KIND_KEY = "codex_approval_kind";
const MCP_APPROVAL_KIND_TOOL_CALL = "mcp_tool_call";
const MCP_APPROVAL_PERSIST_KEY = "persist";
const MCP_APPROVAL_PERSIST_ALWAYS = "always";
const MCP_APPROVAL_PERSIST_SESSION = "session";
const MCP_APPROVAL_TOOL_DESCRIPTION_KEY = "tool_description";
const MCP_APPROVAL_TOOL_PARAMS_KEY = "tool_params";
const MCP_APPROVAL_TOOL_TITLE_KEY = "tool_title";

type SupportedApprovalOutcomes = NonNullable<AgentPendingApprovalRequest["supportedReplyOutcomes"]>;
type PendingApprovalProjection = Omit<
  AgentPendingApprovalRequest,
  "requestId" | "requestInstanceId"
>;
type McpElicitationApprovalProjection = PendingApprovalProjection & {
  metadata: { serverName: string };
};
type LegacyCommandApprovalRequest = Extract<
  CodexServerRequestRecord,
  { method: typeof CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL }
>;
type CommandExecutionApprovalRequest = Extract<
  CodexServerRequestRecord,
  {
    method: typeof CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL;
  }
>;
type CodexCommandApprovalRequest = LegacyCommandApprovalRequest | CommandExecutionApprovalRequest;

const APPROVE_ONCE_AND_REJECT = ["approve_once", "reject"] as const satisfies readonly [
  RuntimeApprovalReplyOutcome,
  RuntimeApprovalReplyOutcome,
];
const APPROVE_ONCE_SESSION_AND_REJECT = [
  "approve_once",
  "approve_session",
  "reject",
] as const satisfies readonly RuntimeApprovalReplyOutcome[];

export const classifyCodexRequestMutation = (
  request: CodexServerRequestRecord,
): AgentApprovalMutation => {
  const method = request.method.trim();
  if (isCodexAppServerFileMutationRequestMethod(method)) {
    return "mutating";
  }
  if (isCodexAppServerPermissionRequestMethod(method)) {
    return classifyCodexPermissionRequestMutation(request);
  }
  if (isCodexCommandApprovalRequest(request)) {
    return classifyCodexCommandRequestMutation(request);
  }
  return "unknown";
};

const classifyApprovalRequestType = (
  request: CodexServerRequestRecord,
): RuntimeApprovalRequestType => {
  if (isCodexAppServerPermissionRequestMethod(request.method)) {
    return "permission_grant";
  }
  if (isCodexAppServerCommandRequestMethod(request.method)) {
    return "command_execution";
  }
  if (isCodexAppServerFileMutationRequestMethod(request.method)) {
    return "file_change";
  }

  const haystack = `${request.method} ${JSON.stringify(request.params ?? {})}`.toLowerCase();
  if (haystack.includes("command") || haystack.includes("exec") || haystack.includes("shell")) {
    return "command_execution";
  }
  if (haystack.includes("file") || haystack.includes("patch") || haystack.includes("write")) {
    return "file_change";
  }
  if (haystack.includes("permission") || haystack.includes("approval")) {
    return "permission_grant";
  }
  return "runtime_tool";
};

const isCodexCommandApprovalRequest = (
  request: CodexServerRequestRecord,
): request is CodexCommandApprovalRequest =>
  request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL ||
  request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL;

const commandTextFromActions = (commands: readonly string[]): string | null => {
  const presentCommands = commands.filter((command) => command.trim().length > 0);
  return presentCommands.length > 0 ? presentCommands.join("; ") : null;
};

const extractCommandText = (request: CodexCommandApprovalRequest): string | null => {
  if (request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL) {
    return (
      commandTextFromActions(request.params.parsedCmd.map((action) => action.cmd)) ??
      (request.params.command.length > 0 ? request.params.command.join(" ") : null)
    );
  }

  return (
    commandTextFromActions(request.params.commandActions?.map((action) => action.command) ?? []) ??
    (request.params.command?.trim() ? request.params.command : null)
  );
};

const extractCommandWorkingDirectory = (request: CodexCommandApprovalRequest): string | null => {
  const workingDirectory = request.params.cwd?.trim();
  return workingDirectory ? workingDirectory : null;
};

const hasNetworkApprovalContext = (request: CodexCommandApprovalRequest): boolean =>
  request.method ===
    CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL &&
  request.params.networkApprovalContext !== undefined &&
  request.params.networkApprovalContext !== null;

const isNetworkPolicyDecision = (
  decision: CodexAppServerCommandExecutionApprovalDecision,
): boolean => {
  if (
    decision === "accept" ||
    decision === "acceptForSession" ||
    decision === "decline" ||
    decision === "cancel"
  ) {
    return false;
  }
  return "applyNetworkPolicyAmendment" in decision;
};

const commandApprovalSupportedReplyOutcomes = (
  request: CodexCommandApprovalRequest,
): SupportedApprovalOutcomes => {
  if (request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL) {
    return [...APPROVE_ONCE_SESSION_AND_REJECT];
  }
  if (
    request.method !==
    CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL
  ) {
    return [...APPROVE_ONCE_AND_REJECT];
  }

  const decisions = request.params.availableDecisions;
  if (!decisions) {
    if (hasNetworkApprovalContext(request)) {
      return [...APPROVE_ONCE_SESSION_AND_REJECT];
    }
    return [...APPROVE_ONCE_AND_REJECT];
  }

  const outcomes: RuntimeApprovalReplyOutcome[] = [];
  if (decisions.some((decision) => decision === "accept")) {
    outcomes.push("approve_once");
  }
  if (decisions.some((decision) => decision === "acceptForSession")) {
    outcomes.push("approve_session");
  }
  if (
    decisions.some(
      (decision) =>
        decision === "decline" || decision === "cancel" || isNetworkPolicyDecision(decision),
    )
  ) {
    outcomes.push("reject");
  }

  return outcomes.length > 0 ? outcomes : [...APPROVE_ONCE_AND_REJECT];
};

const supportedReplyOutcomesForRequest = (
  request: CodexServerRequestRecord,
): SupportedApprovalOutcomes => {
  if (isCodexCommandApprovalRequest(request)) {
    return commandApprovalSupportedReplyOutcomes(request);
  }
  if (
    request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_FILE_CHANGE_REQUEST_APPROVAL ||
    request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL
  ) {
    return [...APPROVE_ONCE_SESSION_AND_REJECT];
  }
  return [...APPROVE_ONCE_AND_REJECT];
};

const commandApprovalFields = (
  request: CodexServerRequestRecord,
): Pick<AgentPendingApprovalRequest, "action" | "command"> => {
  if (!isCodexCommandApprovalRequest(request)) {
    return {};
  }
  const command = extractCommandText(request);
  const workingDirectory = extractCommandWorkingDirectory(request);
  return {
    action: { name: hasNetworkApprovalContext(request) ? "Network access" : "Bash" },
    ...(command
      ? {
          command: {
            command,
            ...(workingDirectory ? { workingDirectory } : undefined),
          },
        }
      : undefined),
  };
};

const approvalContentFields = (
  request: CodexServerRequestRecord,
): Pick<AgentPendingApprovalRequest, "details" | "summary" | "title"> => {
  if (isCodexCommandApprovalRequest(request)) {
    const reason = request.params.reason;
    if (hasNetworkApprovalContext(request)) {
      return {
        title: "Network access approval requested",
        summary: reason ?? "Codex wants to access the network from the shell.",
      };
    }
    return {
      title: "Bash approval requested",
      summary: reason ?? "Codex wants to run a shell command.",
    };
  }
  if (isCodexAppServerPermissionRequestMethod(request.method)) {
    const reason = isPlainObject(request.params)
      ? extractStringField(request.params, ["reason"])
      : null;
    return {
      title: "Permission approval requested",
      summary: reason ?? "Codex requests additional permissions.",
    };
  }
  if (isCodexAppServerFileMutationRequestMethod(request.method)) {
    return {
      title: "File change approval requested",
      summary: "Codex wants to change files.",
    };
  }

  return {
    title: `Codex ${request.method}`,
    summary: `Codex requested ${request.method}.`,
    details: JSON.stringify(request.params ?? {}, null, 2),
  };
};

export const toApprovalRequest = (request: CodexServerRequestRecord): PendingApprovalProjection => {
  if (request.id === undefined) {
    throw new Error("Codex app-server approval request is missing an id.");
  }

  return {
    requestType: classifyApprovalRequestType(request),
    ...approvalContentFields(request),
    mutation: classifyCodexRequestMutation(request),
    supportedReplyOutcomes: supportedReplyOutcomesForRequest(request),
    ...commandApprovalFields(request),
  };
};

const mcpToolApprovalMeta = (
  request: CodexServerRequestRecord,
): Record<string, CodexAppServerJsonValue> | null => {
  if (request.method !== CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST) {
    return null;
  }
  const params = codexAppServerMcpServerElicitationRequestParamsSchema.parse(request.params);
  if (params.mode !== "form" || !isPlainObject(params._meta)) {
    return null;
  }
  return params._meta[MCP_APPROVAL_KIND_KEY] === MCP_APPROVAL_KIND_TOOL_CALL ? params._meta : null;
};

const mcpToolApprovalSupportsPersistMode = (
  meta: Record<string, CodexAppServerJsonValue>,
  expectedMode: typeof MCP_APPROVAL_PERSIST_SESSION | typeof MCP_APPROVAL_PERSIST_ALWAYS,
): boolean => {
  const persist = meta[MCP_APPROVAL_PERSIST_KEY];
  if (persist === expectedMode) {
    return true;
  }
  return Array.isArray(persist) && persist.some((entry) => entry === expectedMode);
};

const mcpToolApprovalSupportedReplyOutcomes = (
  meta: Record<string, CodexAppServerJsonValue>,
): NonNullable<AgentPendingApprovalRequest["supportedReplyOutcomes"]> => {
  const outcomes: NonNullable<AgentPendingApprovalRequest["supportedReplyOutcomes"]> = [
    "approve_once",
  ];
  if (mcpToolApprovalSupportsPersistMode(meta, MCP_APPROVAL_PERSIST_SESSION)) {
    outcomes.push("approve_session");
  }
  if (mcpToolApprovalSupportsPersistMode(meta, MCP_APPROVAL_PERSIST_ALWAYS)) {
    outcomes.push("approve_always");
  }
  outcomes.push("reject");
  return outcomes;
};

export const toMcpElicitationApprovalRequest = (
  request: CodexServerRequestRecord,
): McpElicitationApprovalProjection | null => {
  if (request.method !== CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST) {
    return null;
  }
  if (request.id === undefined) {
    throw new Error("Codex MCP elicitation request is missing an id.");
  }

  const meta = mcpToolApprovalMeta(request);
  if (!meta) {
    return null;
  }
  const params = codexAppServerMcpServerElicitationRequestParamsSchema.parse(request.params);

  const toolName =
    extractStringField(meta, [MCP_APPROVAL_TOOL_TITLE_KEY]) ?? `${params.serverName} MCP tool`;
  const toolTitle = extractStringField(meta, [MCP_APPROVAL_TOOL_TITLE_KEY]) ?? toolName;
  const toolDescription = extractStringField(meta, [MCP_APPROVAL_TOOL_DESCRIPTION_KEY]);
  const toolParams = meta[MCP_APPROVAL_TOOL_PARAMS_KEY];

  return {
    requestType: "runtime_tool",
    title: "MCP Tool Approval",
    summary: params.message,
    ...(toolDescription ? { details: toolDescription } : undefined),
    tool: {
      name: toolName,
      title: toolTitle,
      ...(isPlainObject(toolParams) ? { input: toolParams } : undefined),
    },
    mutation: "unknown",
    supportedReplyOutcomes: mcpToolApprovalSupportedReplyOutcomes(meta),
    metadata: {
      serverName: params.serverName,
    },
  };
};

export const extractTurnId = (value: CodexAppServerJsonValue | undefined): string | null => {
  if (!isPlainObject(value)) {
    return null;
  }
  const direct = extractStringField(value, ["turnId", "expectedTurnId"]);
  if (direct) {
    return direct;
  }
  const turn = value.turn;
  return extractStringField(turn, ["id", "turnId"]);
};

export const extractThreadIdFromParams = (
  value: CodexAppServerJsonValue | undefined,
): string | null => {
  return extractStringField(value, ["threadId", "thread_id", "conversationId"]);
};

export const codexTurnKey = (threadId: string, turnId: string): string => `${threadId}:${turnId}`;

export const isTerminalTurnStatus = (value: CodexAppServerJsonValue | undefined): boolean => {
  if (!isPlainObject(value)) {
    return false;
  }
  const status = extractStringField(value, ["status"]);
  return status === "completed" || status === "failed" || status === "interrupted";
};

type CodexQuestionRequest = Extract<
  CodexServerRequestRecord,
  { method: typeof CODEX_USER_INPUT_REQUEST_METHOD }
>;

export const parseQuestionRequest = (request: CodexQuestionRequest) => {
  if (request.params.questions.length === 0) {
    throw new Error("Codex app-server question request must include questions.");
  }

  const questionIds = request.params.questions.map(({ id }) => id);
  const questions = request.params.questions.map((rawQuestion) => {
    return {
      header: rawQuestion.header,
      question: rawQuestion.question,
      options: rawQuestion.options ?? [],
      ...(rawQuestion.isOther ? { custom: true } : undefined),
    };
  });

  return {
    request: {
      questions,
    },
    threadId: request.params.threadId,
    turnId: request.params.turnId,
    questionIds,
    serverRequestId: request.id,
  } satisfies {
    request: Omit<
      import("@openducktor/core").AgentPendingQuestionRequest,
      "requestId" | "requestInstanceId"
    >;
    threadId: string;
    turnId: string;
    questionIds: string[];
    serverRequestId: CodexAppServerRequestId;
  };
};
