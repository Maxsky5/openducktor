import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerCurrentTimeReadResponse,
  type CodexAppServerJsonObject,
  type CodexAppServerRequestId,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
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

const MAX_CAPTURED_STDERR_BYTES = 64 * 1024;

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

export const extractErrorMessage = errorMessage;

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
  message: CodexAppServerJsonObject,
  kind: "notification",
): CodexAppServerServerNotification;
export function parseStreamMessage(
  runtimeId: string,
  message: CodexAppServerJsonObject,
  kind: "server_request",
): CodexAppServerServerRequest;
export function parseStreamMessage(
  runtimeId: string,
  message: CodexAppServerJsonObject,
  kind: "notification" | "server_request",
): CodexAppServerProtocolMessage {
  const parsedMethod = z.string().safeParse(message.method);
  if (!parsedMethod.success || parsedMethod.data.trim().length === 0) {
    throw new HostValidationError({
      message: `Codex app-server ${kind} for ${runtimeId} is missing a method`,
      field: "method",
      details: { runtimeId, kind },
    });
  }
  const method = parsedMethod.data;
  if (!("params" in message)) {
    throw new HostValidationError({
      message: `Codex app-server ${kind} for ${runtimeId} is missing params`,
      field: "params",
      details: { runtimeId, kind, method },
    });
  }
  if (kind === "server_request") {
    if (!z.union([z.number(), z.string()]).safeParse(message.id).success) {
      throw new HostValidationError({
        message: `Codex app-server server request for ${runtimeId} is missing an id`,
        field: "id",
        details: { runtimeId, kind },
      });
    }
    if (!isCodexServerRequestMethod(method)) {
      throw new HostValidationError({
        message: `Unsupported Codex app-server server request method for ${runtimeId}: ${method}`,
        field: "method",
        details: { runtimeId, kind, method },
      });
    }
    const parsed = codexAppServerServerRequestSchema.safeParse(message);
    if (!parsed.success) {
      throw new HostValidationError({
        message: `Codex app-server ${method} request for ${runtimeId} has invalid params`,
        field: "params",
        cause: parsed.error,
        details: { runtimeId, kind, method },
      });
    }
    return parsed.data;
  }
  if (isCodexServerRequestMethod(method)) {
    throw new HostValidationError({
      message: `Codex app-server server request for ${runtimeId} is missing an id`,
      field: "id",
      details: { runtimeId, kind, method },
    });
  }
  const parsed = codexAppServerServerNotificationSchema.safeParse(message);
  if (!parsed.success) {
    throw new HostValidationError({
      message: `Codex app-server notification for ${runtimeId} has invalid params`,
      field: "params",
      cause: parsed.error,
      details: { runtimeId, kind, method },
    });
  }
  return parsed.data;
}
