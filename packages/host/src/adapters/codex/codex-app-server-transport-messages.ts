import { HostValidationError } from "../../effect/host-errors";
import type {
  CodexAppServerProtocolMessage,
  CodexAppServerRequestResult,
} from "../../ports/codex-app-server-port";
import {
  CODEX_APP_SERVER_SERVER_NOTIFICATION_METHODS,
  CODEX_APP_SERVER_SERVER_REQUEST_METHODS,
  type CodexAppServerCommandExecutionRequestApprovalParams,
  type CodexAppServerExecCommandApprovalParams,
  type CodexAppServerPermissionsRequestApprovalParams,
  type CodexAppServerServerNotificationMethod,
  type CodexAppServerServerRequestMethod,
  isCodexAppServerCommandAction,
  isCodexAppServerJsonValue,
  isCodexAppServerLegacyParsedCommand,
  isCodexAppServerMcpServerElicitationRequestParams,
  isCodexAppServerRequestPermissionProfile,
} from "../../ports/codex-app-server-protocol";

const MAX_BUFFERED_STREAM_MESSAGES = 1_000;
const MAX_CAPTURED_STDERR_BYTES = 64 * 1024;

export const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCodexServerNotificationMethod = (
  method: string,
): method is CodexAppServerServerNotificationMethod =>
  CODEX_APP_SERVER_SERVER_NOTIFICATION_METHODS.some((candidate) => candidate === method);

const isCodexServerRequestMethod = (method: string): method is CodexAppServerServerRequestMethod =>
  CODEX_APP_SERVER_SERVER_REQUEST_METHODS.some((candidate) => candidate === method);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isExecCommandApprovalParams = (
  value: unknown,
): value is CodexAppServerExecCommandApprovalParams =>
  isJsonRecord(value) &&
  (value.approvalId === null || typeof value.approvalId === "string") &&
  typeof value.callId === "string" &&
  isStringArray(value.command) &&
  typeof value.conversationId === "string" &&
  typeof value.cwd === "string" &&
  Array.isArray(value.parsedCmd) &&
  value.parsedCmd.every(isCodexAppServerLegacyParsedCommand) &&
  (value.reason === null || typeof value.reason === "string");

const isOptionalString = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === "string";

const isOptionalJsonArray = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (Array.isArray(value) && value.every(isCodexAppServerJsonValue));

const isCommandExecutionApprovalParams = (
  value: unknown,
): value is CodexAppServerCommandExecutionRequestApprovalParams =>
  isJsonRecord(value) &&
  typeof value.itemId === "string" &&
  typeof value.startedAtMs === "number" &&
  Number.isFinite(value.startedAtMs) &&
  typeof value.threadId === "string" &&
  typeof value.turnId === "string" &&
  isOptionalString(value.approvalId) &&
  isOptionalString(value.command) &&
  isOptionalString(value.cwd) &&
  isOptionalString(value.reason) &&
  (value.commandActions === undefined ||
    value.commandActions === null ||
    (Array.isArray(value.commandActions) &&
      value.commandActions.every(isCodexAppServerCommandAction))) &&
  (value.additionalPermissions === undefined ||
    value.additionalPermissions === null ||
    isCodexAppServerRequestPermissionProfile(value.additionalPermissions)) &&
  (value.networkApprovalContext === undefined ||
    value.networkApprovalContext === null ||
    isCodexAppServerJsonValue(value.networkApprovalContext)) &&
  (value.proposedExecpolicyAmendment === undefined ||
    value.proposedExecpolicyAmendment === null ||
    isCodexAppServerJsonValue(value.proposedExecpolicyAmendment)) &&
  isOptionalJsonArray(value.proposedNetworkPolicyAmendments);

const isPermissionsRequestApprovalParams = (
  value: unknown,
): value is CodexAppServerPermissionsRequestApprovalParams =>
  isJsonRecord(value) &&
  typeof value.threadId === "string" &&
  typeof value.turnId === "string" &&
  typeof value.itemId === "string" &&
  typeof value.startedAtMs === "number" &&
  Number.isFinite(value.startedAtMs) &&
  typeof value.cwd === "string" &&
  isOptionalString(value.reason) &&
  isCodexAppServerRequestPermissionProfile(value.permissions);

export const resolveAfterQueuedMessages = (
  resolve: (value: CodexAppServerRequestResult) => void,
  value: CodexAppServerRequestResult,
): void => {
  setImmediate(() => resolve(value));
};

export const pushBoundedMessage = <Message>(messages: Message[], message: Message): void => {
  messages.push(message);
  if (messages.length > MAX_BUFFERED_STREAM_MESSAGES) {
    messages.splice(0, messages.length - MAX_BUFFERED_STREAM_MESSAGES);
  }
};

export const appendCapturedStderr = (current: string, line: string): string => {
  const next = current.length > 0 ? `${current}\n${line}` : line;
  const encoded = Buffer.from(next, "utf8");
  if (encoded.byteLength <= MAX_CAPTURED_STDERR_BYTES) {
    return next;
  }
  return encoded.subarray(encoded.byteLength - MAX_CAPTURED_STDERR_BYTES).toString("utf8");
};

export const extractErrorMessage = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (isJsonRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return JSON.stringify(value);
};

export const parseStreamMessage = (
  runtimeId: string,
  message: Record<string, unknown>,
  kind: "notification" | "server_request",
): CodexAppServerProtocolMessage => {
  if (typeof message.method !== "string") {
    throw new HostValidationError({
      message: `Codex app-server ${kind} for ${runtimeId} is missing a method`,
      field: "method",
      details: { runtimeId, kind },
    });
  }
  if (!("params" in message)) {
    throw new HostValidationError({
      message: `Codex app-server ${kind} for ${runtimeId} is missing params`,
      field: "params",
      details: { runtimeId, kind, method: message.method },
    });
  }
  if (!isCodexAppServerJsonValue(message.params)) {
    throw new HostValidationError({
      message: `Codex app-server ${kind} params for ${runtimeId} must be JSON-compatible`,
      field: "params",
      details: { runtimeId, kind, method: message.method },
    });
  }
  if (kind === "server_request") {
    if (typeof message.id !== "number" && typeof message.id !== "string") {
      throw new HostValidationError({
        message: `Codex app-server server request for ${runtimeId} is missing an id`,
        field: "id",
        details: { runtimeId, kind },
      });
    }
    const serverRequestId = message.id;
    if (!isCodexServerRequestMethod(message.method)) {
      throw new HostValidationError({
        message: `Unsupported Codex app-server server request method for ${runtimeId}: ${message.method}`,
        field: "method",
        details: { runtimeId, kind, method: message.method },
      });
    }
    if (message.method === "execCommandApproval") {
      if (!isExecCommandApprovalParams(message.params)) {
        throw new HostValidationError({
          message: `Codex app-server execCommandApproval request for ${runtimeId} has invalid params`,
          field: "params",
          details: { runtimeId, kind, method: message.method },
        });
      }
      return {
        method: message.method,
        id: serverRequestId,
        params: message.params,
      };
    }
    if (message.method === "item/commandExecution/requestApproval") {
      if (!isCommandExecutionApprovalParams(message.params)) {
        throw new HostValidationError({
          message: `Codex app-server command execution approval request for ${runtimeId} has invalid params`,
          field: "params",
          details: { runtimeId, kind, method: message.method },
        });
      }
      return {
        method: message.method,
        id: serverRequestId,
        params: message.params,
      };
    }
    if (message.method === "item/permissions/requestApproval") {
      if (!isPermissionsRequestApprovalParams(message.params)) {
        throw new HostValidationError({
          message: `Codex app-server permissions approval request for ${runtimeId} has invalid params`,
          field: "params",
          details: { runtimeId, kind, method: message.method },
        });
      }
      return {
        method: message.method,
        id: serverRequestId,
        params: message.params,
      };
    }
    if (message.method === "mcpServer/elicitation/request") {
      if (!isCodexAppServerMcpServerElicitationRequestParams(message.params)) {
        throw new HostValidationError({
          message: `Codex app-server MCP server elicitation request for ${runtimeId} has invalid params`,
          field: "params",
          details: { runtimeId, kind, method: message.method },
        });
      }
      return {
        method: message.method,
        id: serverRequestId,
        params: message.params,
      };
    }
    return {
      method: message.method,
      id: serverRequestId,
      params: message.params,
    };
  }
  if (!isCodexServerNotificationMethod(message.method)) {
    throw new HostValidationError({
      message: `Unsupported Codex app-server notification method for ${runtimeId}: ${message.method}`,
      field: "method",
      details: { runtimeId, kind, method: message.method },
    });
  }
  return {
    method: message.method,
    params: message.params,
  };
};
