import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  isCodexAppServerCommandRequestMethod,
  isCodexAppServerFileMutationRequestMethod,
  isCodexAppServerMcpServerElicitationRequestParams,
  isCodexAppServerPermissionRequestMethod,
  type RuntimeApprovalReplyOutcome,
  type RuntimeApprovalRequestType,
} from "@openducktor/contracts";
import type {
  AgentApprovalMutation,
  AgentPendingApprovalRequest,
  AgentRole,
} from "@openducktor/core";
import { extractStringField, isPlainObject } from "./codex-app-server-shared";
import { classifyCodexCommandRequestMutation } from "./codex-command-approvals";
import { classifyCodexPermissionRequestMutation } from "./codex-permission-approvals";
import type { CodexNotificationRecord, CodexServerRequestRecord } from "./types";

export { codexApprovalResponseForRequest } from "./codex-approval-responses";

const MCP_APPROVAL_KIND_KEY = "codex_approval_kind";
const MCP_APPROVAL_KIND_TOOL_CALL = "mcp_tool_call";
const MCP_APPROVAL_PERSIST_KEY = "persist";
const MCP_APPROVAL_PERSIST_ALWAYS = "always";
const MCP_APPROVAL_PERSIST_SESSION = "session";
const MCP_APPROVAL_TOOL_DESCRIPTION_KEY = "tool_description";
const MCP_APPROVAL_TOOL_NAME_KEY = "tool_name";
const MCP_APPROVAL_TOOL_PARAMS_KEY = "tool_params";
const MCP_APPROVAL_TOOL_TITLE_KEY = "tool_title";

type SupportedApprovalOutcomes = NonNullable<AgentPendingApprovalRequest["supportedReplyOutcomes"]>;

const APPROVE_ONCE_AND_REJECT = ["approve_once", "reject"] as const satisfies readonly [
  RuntimeApprovalReplyOutcome,
  RuntimeApprovalReplyOutcome,
];
const APPROVE_ONCE_SESSION_AND_REJECT = [
  "approve_once",
  "approve_session",
  "reject",
] as const satisfies readonly RuntimeApprovalReplyOutcome[];

export const parseServerRequestRecord = (value: unknown): CodexServerRequestRecord => {
  if (!isPlainObject(value)) {
    throw new Error("Codex app-server server request must be an object.");
  }

  const { id, method, params } = value;
  if (id !== undefined && typeof id !== "number" && typeof id !== "string") {
    throw new Error("Codex app-server server request id must be a string or number when present.");
  }
  if (typeof method !== "string" || method.trim().length === 0) {
    throw new Error("Codex app-server server request is missing method.");
  }

  return {
    ...(id !== undefined ? { id } : {}),
    method: method.trim(),
    ...(params !== undefined ? { params } : {}),
  };
};

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
  if (isCodexAppServerCommandRequestMethod(method)) {
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

const extractCommandText = (params: unknown): string | null => {
  if (!isPlainObject(params)) {
    return null;
  }
  const commandActions = Array.isArray(params.commandActions)
    ? params.commandActions
    : Array.isArray(params.parsedCmd)
      ? params.parsedCmd
      : null;
  if (commandActions) {
    const actionCommands = commandActions
      .map((action) => {
        if (!isPlainObject(action)) {
          return null;
        }
        const command = action.command ?? action.cmd;
        return typeof command === "string" && command.trim().length > 0 ? command : null;
      })
      .filter((command): command is string => command !== null);
    if (actionCommands.length === 1) {
      return actionCommands[0] ?? null;
    }
    if (actionCommands.length > 1) {
      return actionCommands.join("; ");
    }
  }

  const command = params.command;
  if (typeof command === "string" && command.trim().length > 0) {
    return command;
  }
  if (Array.isArray(command)) {
    const parts = command.filter((part): part is string => typeof part === "string");
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
};

const extractCommandWorkingDirectory = (params: unknown): string | null =>
  isPlainObject(params) ? extractStringField(params, ["cwd"]) : null;

const hasNetworkApprovalContext = (request: CodexServerRequestRecord): boolean =>
  request.method ===
    CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL &&
  isPlainObject(request.params) &&
  request.params.networkApprovalContext !== undefined &&
  request.params.networkApprovalContext !== null;

const isDecisionObject = (value: unknown, key: string): boolean =>
  isPlainObject(value) && key in value;

const commandApprovalSupportedReplyOutcomes = (
  request: CodexServerRequestRecord,
): SupportedApprovalOutcomes => {
  if (request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL) {
    return [...APPROVE_ONCE_SESSION_AND_REJECT];
  }
  if (
    request.method !==
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL ||
    !isPlainObject(request.params)
  ) {
    return [...APPROVE_ONCE_AND_REJECT];
  }

  const decisions = Array.isArray(request.params.availableDecisions)
    ? request.params.availableDecisions
    : null;
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
        decision === "decline" ||
        decision === "cancel" ||
        isDecisionObject(decision, "applyNetworkPolicyAmendment"),
    )
  ) {
    outcomes.push("reject");
  }

  return outcomes.length > 0 ? outcomes : [...APPROVE_ONCE_AND_REJECT];
};

const supportedReplyOutcomesForRequest = (
  request: CodexServerRequestRecord,
): SupportedApprovalOutcomes => {
  if (isCodexAppServerCommandRequestMethod(request.method)) {
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
  if (!isCodexAppServerCommandRequestMethod(request.method)) {
    return {};
  }
  const command = extractCommandText(request.params);
  const workingDirectory = extractCommandWorkingDirectory(request.params);
  return {
    action: { name: hasNetworkApprovalContext(request) ? "Network access" : "Bash" },
    ...(command
      ? {
          command: {
            command,
            ...(workingDirectory ? { workingDirectory } : {}),
          },
        }
      : {}),
  };
};

const approvalContentFields = (
  request: CodexServerRequestRecord,
): Pick<AgentPendingApprovalRequest, "details" | "summary" | "title"> => {
  if (isCodexAppServerCommandRequestMethod(request.method)) {
    const reason = isPlainObject(request.params)
      ? extractStringField(request.params, ["reason"])
      : null;
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

export const toApprovalRequest = (
  request: CodexServerRequestRecord,
  role: AgentRole,
): AgentPendingApprovalRequest => {
  if (request.id === undefined) {
    throw new Error("Codex app-server approval request is missing an id.");
  }

  return {
    requestId: String(request.id),
    requestType: classifyApprovalRequestType(request),
    ...approvalContentFields(request),
    mutation: classifyCodexRequestMutation(request),
    supportedReplyOutcomes: supportedReplyOutcomesForRequest(request),
    ...commandApprovalFields(request),
    metadata: {
      codexMethod: request.method,
      role,
      params: request.params,
    },
  };
};

const mcpToolApprovalMeta = (request: CodexServerRequestRecord): Record<string, unknown> | null => {
  if (request.method !== CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST) {
    return null;
  }
  if (!isCodexAppServerMcpServerElicitationRequestParams(request.params)) {
    throw new Error("Codex MCP elicitation request params must match the app-server schema.");
  }
  if (request.params.mode !== "form" || !isPlainObject(request.params._meta)) {
    return null;
  }
  return request.params._meta[MCP_APPROVAL_KIND_KEY] === MCP_APPROVAL_KIND_TOOL_CALL
    ? request.params._meta
    : null;
};

const mcpToolApprovalSupportsPersistMode = (
  meta: Record<string, unknown>,
  expectedMode: typeof MCP_APPROVAL_PERSIST_SESSION | typeof MCP_APPROVAL_PERSIST_ALWAYS,
): boolean => {
  const persist = meta[MCP_APPROVAL_PERSIST_KEY];
  if (persist === expectedMode) {
    return true;
  }
  return Array.isArray(persist) && persist.some((entry) => entry === expectedMode);
};

const mcpToolApprovalSupportedReplyOutcomes = (
  meta: Record<string, unknown>,
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
): AgentPendingApprovalRequest | null => {
  if (request.method !== CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST) {
    return null;
  }
  if (request.id === undefined) {
    throw new Error("Codex MCP elicitation request is missing an id.");
  }

  const meta = mcpToolApprovalMeta(request);
  if (!meta || !isCodexAppServerMcpServerElicitationRequestParams(request.params)) {
    return null;
  }

  const toolName =
    extractStringField(meta, [MCP_APPROVAL_TOOL_NAME_KEY]) ??
    extractStringField(meta, [MCP_APPROVAL_TOOL_TITLE_KEY]) ??
    `${request.params.serverName} MCP tool`;
  const toolTitle = extractStringField(meta, [MCP_APPROVAL_TOOL_TITLE_KEY]) ?? toolName;
  const toolDescription = extractStringField(meta, [MCP_APPROVAL_TOOL_DESCRIPTION_KEY]);
  const toolParams = meta[MCP_APPROVAL_TOOL_PARAMS_KEY];

  return {
    requestId: String(request.id),
    requestType: "runtime_tool",
    title: "MCP Tool Approval",
    summary: request.params.message,
    ...(toolDescription ? { details: toolDescription } : {}),
    tool: {
      name: toolName,
      title: toolTitle,
      ...(isPlainObject(toolParams) ? { input: toolParams } : {}),
    },
    mutation: "unknown",
    supportedReplyOutcomes: mcpToolApprovalSupportedReplyOutcomes(meta),
    metadata: {
      codexMethod: request.method,
      params: request.params,
      serverName: request.params.serverName,
    },
  };
};

export const extractTurnId = (value: unknown): string | null => {
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

export const extractThreadIdFromParams = (value: unknown): string | null => {
  return extractStringField(value, ["threadId", "thread_id", "conversationId"]);
};

export const codexTurnKey = (threadId: string, turnId: string): string => `${threadId}:${turnId}`;

export const isTerminalTurnStatus = (value: unknown): boolean => {
  if (!isPlainObject(value)) {
    return false;
  }
  const status = extractStringField(value, ["status"]);
  return status === "completed" || status === "failed" || status === "interrupted";
};

export const parseQuestionRequest = (
  request: CodexServerRequestRecord,
): {
  request: import("@openducktor/core").AgentPendingQuestionRequest;
  threadId: string;
  turnId: string;
  questionIds: string[];
} => {
  if (request.id === undefined) {
    throw new Error("Codex app-server question request is missing an id.");
  }
  if (!isPlainObject(request.params)) {
    throw new Error("Codex app-server question request params must be an object.");
  }

  const threadId = extractStringField(request.params, ["threadId"]);
  const turnId = extractStringField(request.params, ["turnId"]);
  if (!threadId) {
    throw new Error("Codex app-server question request is missing threadId.");
  }
  if (!turnId) {
    throw new Error("Codex app-server question request is missing turnId.");
  }

  const rawQuestions = request.params.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error("Codex app-server question request must include questions.");
  }

  const questionIds: string[] = [];
  const questions = rawQuestions.map((rawQuestion) => {
    if (!isPlainObject(rawQuestion)) {
      throw new Error("Codex app-server question entries must be objects.");
    }
    const id = extractStringField(rawQuestion, ["id", "questionId"]);
    if (!id) {
      throw new Error("Codex app-server question entry is missing id.");
    }
    questionIds.push(id);
    const options = Array.isArray(rawQuestion.options)
      ? rawQuestion.options.map((rawOption) => {
          if (typeof rawOption === "string") {
            return { label: rawOption, description: "" };
          }
          if (!isPlainObject(rawOption)) {
            throw new Error("Codex app-server question option entries must be strings or objects.");
          }
          const label = extractStringField(rawOption, ["label", "value", "text"]);
          if (!label) {
            throw new Error("Codex app-server question option entry is missing label.");
          }
          return {
            label,
            description: extractStringField(rawOption, ["description", "detail"]) ?? "",
          };
        })
      : [];
    const header = extractStringField(rawQuestion, ["header", "title"]);
    const question = extractStringField(rawQuestion, ["question", "text", "prompt"]);
    if (!header) {
      throw new Error(`Codex app-server question '${id}' is missing header.`);
    }
    if (!question) {
      throw new Error(`Codex app-server question '${id}' is missing question text.`);
    }
    return {
      header,
      question,
      options,
      ...(rawQuestion.multiple === true || rawQuestion.multi === true ? { multiple: true } : {}),
      ...(rawQuestion.isOther === true || rawQuestion.custom === true ? { custom: true } : {}),
    };
  });

  return {
    request: {
      requestId: String(request.id),
      questions,
    },
    threadId,
    turnId,
    questionIds,
  };
};

export const parseNotificationRecord = (
  value: unknown,
  receivedAt?: string,
): CodexNotificationRecord => {
  if (!isPlainObject(value)) {
    throw new Error("Codex app-server notification must be an object.");
  }
  const { method, params } = value;
  if (typeof method !== "string" || method.trim().length === 0) {
    throw new Error("Codex app-server notification is missing method.");
  }
  const parsedReceivedAt =
    receivedAt ??
    (typeof value.receivedAt === "string" ? value.receivedAt : new Date().toISOString());
  return {
    method: method.trim(),
    ...(params !== undefined ? { params } : {}),
    receivedAt: parsedReceivedAt,
  };
};
