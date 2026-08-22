import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerRequestId,
  codexAppServerMcpServerElicitationRequestParamsSchema,
  isCodexAppServerCommandRequestMethod,
  isCodexAppServerFileMutationRequestMethod,
  isCodexAppServerPermissionRequestMethod,
  type RuntimeApprovalReplyOutcome,
  type RuntimeApprovalRequestType,
  hasRuntimeType,
} from "@openducktor/contracts";
import type { AgentApprovalMutation, AgentPendingApprovalRequest } from "@openducktor/core";
import { extractStringField, isPlainObject } from "./codex-app-server-shared";
import { classifyCodexCommandRequestMutation } from "./codex-command-approvals";
import { classifyCodexPermissionRequestMutation } from "./codex-permission-approvals";
import type { CodexServerRequestRecord } from "./types";
import type { JsonValue } from "@openducktor/contracts";

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

const extractCommandText = (params: JsonValue | undefined): string | null => {
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
        return hasRuntimeType(command, "string") && command.trim().length > 0 ? command : null;
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
  if (hasRuntimeType(command, "string") && command.trim().length > 0) {
    return command;
  }
  if (Array.isArray(command)) {
    const parts = command.filter((part): part is string => typeof part === "string");
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
};

const extractCommandWorkingDirectory = (params: JsonValue | undefined): string | null =>
  isPlainObject(params) ? extractStringField(params, ["cwd"]) : null;

const hasNetworkApprovalContext = (request: CodexServerRequestRecord): boolean =>
  request.method ===
    CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL &&
  isPlainObject(request.params) &&
  request.params.networkApprovalContext !== undefined &&
  request.params.networkApprovalContext !== null;

const isDecisionObject = (value: JsonValue | undefined, key: string): boolean =>
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
            ...(workingDirectory ? { workingDirectory } : undefined),
          },
        }
      : undefined),
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
): Record<string, JsonValue> | null => {
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
  meta: Record<string, JsonValue>,
  expectedMode: typeof MCP_APPROVAL_PERSIST_SESSION | typeof MCP_APPROVAL_PERSIST_ALWAYS,
): boolean => {
  const persist = meta[MCP_APPROVAL_PERSIST_KEY];
  if (persist === expectedMode) {
    return true;
  }
  return Array.isArray(persist) && persist.some((entry) => entry === expectedMode);
};

const mcpToolApprovalSupportedReplyOutcomes = (
  meta: Record<string, JsonValue>,
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
): PendingApprovalProjection | null => {
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

export const extractTurnId = (value: JsonValue | undefined): string | null => {
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

export const extractThreadIdFromParams = (value: JsonValue | undefined): string | null => {
  return extractStringField(value, ["threadId", "thread_id", "conversationId"]);
};

export const codexTurnKey = (threadId: string, turnId: string): string => `${threadId}:${turnId}`;

export const isTerminalTurnStatus = (value: JsonValue | undefined): boolean => {
  if (!isPlainObject(value)) {
    return false;
  }
  const status = extractStringField(value, ["status"]);
  return status === "completed" || status === "failed" || status === "interrupted";
};

export const parseQuestionRequest = (request: CodexServerRequestRecord) => {
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
          if (hasRuntimeType(rawOption, "string")) {
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
      ...(rawQuestion.multiple === true || rawQuestion.multi === true
        ? { multiple: true }
        : undefined),
      ...(rawQuestion.isOther === true || rawQuestion.custom === true
        ? { custom: true }
        : undefined),
    };
  });

  return {
    request: {
      questions,
    },
    threadId,
    turnId,
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
