import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type {
  CodexAppServerProtocolMessage,
  CodexAppServerRequestResult,
} from "../../ports/codex-app-server-port";
import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHODS,
  type CodexAppServerServerNotification,
  type CodexAppServerServerRequest,
  type CodexAppServerServerRequestMethod,
  codexAppServerServerRequestSchema,
  codexAppServerServerNotificationSchema,
} from "../../ports/codex-app-server-protocol";
import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerCurrentTimeReadResponse,
  type CodexAppServerRequestId,
} from "@openducktor/contracts";

const MAX_CAPTURED_STDERR_BYTES = 64 * 1024;

export const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCodexServerRequestMethod = (method: string): method is CodexAppServerServerRequestMethod =>
  CODEX_APP_SERVER_SERVER_REQUEST_METHODS.some((candidate) => candidate === method);

export const resolveAfterQueuedMessages = (
  resolve: (value: CodexAppServerRequestResult) => void,
  value: CodexAppServerRequestResult,
): void => {
  setImmediate(() => resolve(value));
};

export const appendCapturedStderr = (current: string, line: string): string => {
  const next = current.length > 0 ? `${current}\n${line}` : line;
  const encoded = Buffer.from(next, "utf8");
  if (encoded.byteLength <= MAX_CAPTURED_STDERR_BYTES) {
    return next;
  }
  return encoded.subarray(encoded.byteLength - MAX_CAPTURED_STDERR_BYTES).toString("utf8");
};

export const extractErrorMessage = (cause: unknown): string => {
  if (typeof cause === "string") {
    return cause;
  }
  if (isJsonRecord(cause) && typeof cause.message === "string") {
    return cause.message;
  }
  return JSON.stringify(cause ?? null);
};

type SendAutomaticServerResponse = (message: {
  jsonrpc: "2.0";
  id: CodexAppServerRequestId;
  result: CodexAppServerCurrentTimeReadResponse;
}) => Effect.Effect<void, Error>;

export const respondToAutomaticServerRequest = (
  request: CodexAppServerServerRequest,
  sendResponse: SendAutomaticServerResponse,
  failFast: (error: Error) => void,
): boolean => {
  if (request.method !== CODEX_APP_SERVER_SERVER_REQUEST_METHOD.CURRENT_TIME_READ) {
    return false;
  }
  const result: CodexAppServerCurrentTimeReadResponse = {
    currentTimeAt: Math.floor(Date.now() / 1_000),
  };
  Effect.runFork(
    sendResponse({ jsonrpc: "2.0", id: request.id, result }).pipe(
      Effect.catchAll((error) => Effect.sync(() => failFast(error))),
    ),
  );
  return true;
};

export function parseStreamMessage(
  runtimeId: string,
  message: Record<string, unknown>,
  kind: "notification",
): CodexAppServerServerNotification;
export function parseStreamMessage(
  runtimeId: string,
  message: Record<string, unknown>,
  kind: "server_request",
): CodexAppServerServerRequest;
export function parseStreamMessage(
  runtimeId: string,
  message: Record<string, unknown>,
  kind: "notification" | "server_request",
): CodexAppServerProtocolMessage {
  if (!(typeof message.method === "string") || message.method.trim().length === 0) {
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
  if (kind === "server_request") {
    if (!(typeof message.id === "number") && !(typeof message.id === "string")) {
      throw new HostValidationError({
        message: `Codex app-server server request for ${runtimeId} is missing an id`,
        field: "id",
        details: { runtimeId, kind },
      });
    }
    if (!isCodexServerRequestMethod(message.method)) {
      throw new HostValidationError({
        message: `Unsupported Codex app-server server request method for ${runtimeId}: ${message.method}`,
        field: "method",
        details: { runtimeId, kind, method: message.method },
      });
    }
    const parsed = codexAppServerServerRequestSchema.safeParse(message);
    if (!parsed.success) {
      throw new HostValidationError({
        message: `Codex app-server ${message.method} request for ${runtimeId} has invalid params`,
        field: "params",
        cause: parsed.error,
        details: { runtimeId, kind, method: message.method },
      });
    }
    return parsed.data;
  }
  if (isCodexServerRequestMethod(message.method)) {
    throw new HostValidationError({
      message: `Codex app-server server request for ${runtimeId} is missing an id`,
      field: "id",
      details: { runtimeId, kind, method: message.method },
    });
  }
  const parsed = codexAppServerServerNotificationSchema.safeParse(message);
  if (!parsed.success) {
    throw new HostValidationError({
      message: `Codex app-server notification for ${runtimeId} has invalid params`,
      field: "params",
      cause: parsed.error,
      details: { runtimeId, kind, method: message.method },
    });
  }
  return parsed.data;
}
