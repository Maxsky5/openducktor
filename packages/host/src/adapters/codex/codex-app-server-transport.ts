import { createInterface } from "node:readline";
import { Effect, Exit } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  CodexAppServerProtocolMessage,
  CodexAppServerRespondInput,
} from "../../ports/codex-app-server-port";
import {
  type CodexAppServerClientRequest,
  parseCodexAppServerRequestResult,
} from "../../ports/codex-app-server-protocol";
import { acquirePendingResponse } from "./codex-app-server-pending-response";
import { writeCodexAppServerRequestLine } from "./codex-app-server-request-writer";
import {
  appendCapturedStderr,
  extractErrorMessage,
  isJsonRecord,
  parseStreamMessage,
  pushBoundedMessage,
} from "./codex-app-server-transport-messages";
import type {
  CodexAppServerChildTransport,
  CodexAppServerEventEmitter,
  CodexAppServerStreamEvent,
  CodexChildProcess,
  PendingCodexAppServerRequest,
} from "./codex-app-server-transport-types";
import { writeJsonLine } from "./codex-json-line-writer";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MAX_CANCELLED_SENT_REQUEST_IDS = 1_000;

export const createCodexAppServerTransport = (
  runtimeId: string,
  child: CodexChildProcess,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  eventEmitter?: CodexAppServerEventEmitter,
): CodexAppServerChildTransport => {
  let nextRequestId = 1;
  let closed = false;
  let fatalError: Error | null = null;
  const pending = new Map<number, PendingCodexAppServerRequest>();
  const cancelledSentRequests = new Map<number, NodeJS.Timeout>();
  const notifications: CodexAppServerProtocolMessage[] = [];
  const serverRequests: CodexAppServerProtocolMessage[] = [];
  let stderrOutput = "";
  let stdoutClosed = false;
  let stderrClosed = false;

  const failFast = (error: Error): void => {
    if (!fatalError) {
      fatalError = error;
    }
    closed = true;
    for (const timeout of cancelledSentRequests.values()) {
      clearTimeout(timeout);
    }
    cancelledSentRequests.clear();
    for (const [id, request] of pending) {
      clearTimeout(request.timeout);
      request.reject(error);
      pending.delete(id);
    }
  };

  const ensureOpen = (): void => {
    if (fatalError) {
      throw fatalError;
    }
    if (closed) {
      throw new HostResourceError({
        resource: "codexAppServerTransport",
        operation: "codexAppServerTransport.ensureOpen",
        message: `Codex app-server transport for runtime ${runtimeId} is closed`,
        details: { runtimeId },
      });
    }
  };

  const ensureOpenEffect = () =>
    Effect.try({
      try: ensureOpen,
      catch: (cause) =>
        toHostOperationError(cause, "codexAppServerTransport.ensureOpen", { runtimeId }),
    });

  const sendMessage = (message: Record<string, unknown>) =>
    Effect.gen(function* () {
      yield* ensureOpenEffect();
      yield* writeJsonLine(child.stdin, message).pipe(
        Effect.mapError(
          (error) =>
            new HostOperationError({
              operation: "codexAppServerTransport.sendMessage",
              message: `Failed writing Codex app-server message for runtime ${runtimeId}`,
              cause: error,
              details: { runtimeId },
            }),
        ),
      );
    });

  const sendRequestMessage = (message: Record<string, unknown>, markWriteStarted: () => void) =>
    Effect.gen(function* () {
      yield* ensureOpenEffect();
      yield* writeCodexAppServerRequestLine({
        stdin: child.stdin,
        payload: message,
        runtimeId,
        markWriteStarted,
      });
    });

  const forgetCancelledSentRequest = (id: number): boolean => {
    const timeout = cancelledSentRequests.get(id);
    if (!timeout) {
      return false;
    }
    clearTimeout(timeout);
    cancelledSentRequests.delete(id);
    return true;
  };

  const rememberCancelledSentRequest = (id: number): void => {
    forgetCancelledSentRequest(id);
    const timeout = setTimeout(() => {
      cancelledSentRequests.delete(id);
    }, requestTimeoutMs);
    cancelledSentRequests.set(id, timeout);
    if (cancelledSentRequests.size <= MAX_CANCELLED_SENT_REQUEST_IDS) {
      return;
    }
    const oldestId = cancelledSentRequests.keys().next().value;
    if (typeof oldestId === "number") {
      forgetCancelledSentRequest(oldestId);
    }
  };

  const resolveResponse = (id: number, message: Record<string, unknown>): void => {
    const request = pending.get(id);
    if (!request) {
      if (forgetCancelledSentRequest(id)) {
        return;
      }
      failFast(
        new HostValidationError({
          message: `Received Codex app-server response with unexpected id ${id} for ${runtimeId}`,
          field: "id",
          details: { runtimeId, id },
        }),
      );
      return;
    }
    pending.delete(id);
    clearTimeout(request.timeout);

    if ("error" in message) {
      request.reject(
        new HostOperationError({
          operation: `codexAppServerTransport.request.${request.method}`,
          message: `Codex app-server request ${request.method} failed for runtime ${runtimeId}: ${extractErrorMessage(message.error)}`,
          details: { runtimeId, method: request.method },
        }),
      );
      return;
    }
    if (!("result" in message)) {
      request.reject(
        new HostValidationError({
          message: `Codex app-server response ${id} for runtime ${runtimeId} is missing result or error`,
          field: "result",
          details: { runtimeId, id },
        }),
      );
      return;
    }
    const result = Effect.try({
      try: () => parseCodexAppServerRequestResult(request.method, message.result),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          field: "result",
          details: { runtimeId, id, method: request.method },
        }),
    });
    const parsedResult = Effect.runSync(Effect.either(result));
    if (parsedResult._tag === "Left") {
      request.reject(parsedResult.left);
      return;
    }
    request.resolve(parsedResult.right);
  };
  const emitEvent = (
    event: CodexAppServerStreamEvent,
    pendingEvents: CodexAppServerProtocolMessage[],
    options: { bufferWhenEmitting: boolean },
  ): void => {
    if (!eventEmitter || options.bufferWhenEmitting) {
      pushBoundedMessage(pendingEvents, event.message);
    }
    if (!eventEmitter) {
      return;
    }
    try {
      eventEmitter(event);
    } catch (error) {
      failFast(
        new HostOperationError({
          operation: "codexAppServerTransport.emitEvent",
          message: `Failed emitting Codex app-server ${event.kind} event for runtime ${runtimeId}`,
          cause: error,
          details: { runtimeId, eventKind: event.kind },
        }),
      );
    }
  };

  const handleMessage = (message: unknown): void => {
    if (!isJsonRecord(message)) {
      failFast(
        new HostValidationError({
          message: `Codex app-server stdout message for ${runtimeId} must be an object`,
          details: { runtimeId },
        }),
      );
      return;
    }

    const responseId = typeof message.id === "number" ? message.id : null;
    const serverRequestId =
      typeof message.id === "number" || typeof message.id === "string" ? message.id : null;
    const hasMethod = typeof message.method === "string";
    const hasResponse = "result" in message || "error" in message;

    if (hasResponse) {
      if (responseId === null) {
        failFast(
          new HostValidationError({
            message: `Codex app-server response for ${runtimeId} is missing a numeric id`,
            field: "id",
            details: { runtimeId },
          }),
        );
        return;
      }
      resolveResponse(responseId, message);
      return;
    }

    if (hasMethod && serverRequestId === null) {
      try {
        emitEvent(
          {
            runtimeId,
            kind: "notification",
            message: parseStreamMessage(runtimeId, message, "notification"),
          },
          notifications,
          {
            bufferWhenEmitting: true,
          },
        );
      } catch (error) {
        failFast(
          toHostOperationError(error, "codexAppServerTransport.parseNotification", {
            runtimeId,
          }),
        );
      }
      return;
    }

    if (hasMethod && serverRequestId !== null) {
      try {
        emitEvent(
          {
            runtimeId,
            kind: "server_request",
            message: parseStreamMessage(runtimeId, message, "server_request"),
          },
          serverRequests,
          {
            bufferWhenEmitting: false,
          },
        );
      } catch (error) {
        failFast(
          toHostOperationError(error, "codexAppServerTransport.parseServerRequest", {
            runtimeId,
          }),
        );
      }
      return;
    }

    failFast(
      new HostValidationError({
        message: `Codex app-server stdout message for ${runtimeId} is not valid JSON-RPC`,
        details: { runtimeId },
      }),
    );
  };

  const processClosedError = (detail: string): HostOperationError => {
    const stderr = stderrOutput.trim();
    return new HostOperationError({
      operation: "codexAppServerTransport.childProcess",
      message:
        stderr.length > 0
          ? `Codex app-server ${detail} for runtime ${runtimeId}: ${stderr}`
          : `Codex app-server ${detail} for runtime ${runtimeId}`,
      details: { runtimeId, stderr },
    });
  };

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      handleMessage(JSON.parse(trimmed));
    } catch (error) {
      failFast(
        new HostValidationError({
          message: `Invalid Codex app-server JSON on stdout for runtime ${runtimeId}: ${trimmed}`,
          cause: error,
          details: { runtimeId },
        }),
      );
    }
  });
  lines.on("close", () => {
    stdoutClosed = true;
    if (!closed) {
      failFast(processClosedError("stdout closed unexpectedly"));
    }
  });
  const stderrLines = createInterface({ input: child.stderr });
  stderrLines.on("line", (line) => {
    if (line.trim().length > 0) {
      stderrOutput = appendCapturedStderr(stderrOutput, line);
    }
  });
  stderrLines.on("close", () => {
    stderrClosed = true;
  });
  child.stderr.on("error", (error) => failFast(error));
  child.once("error", (error) => failFast(error));
  child.once("close", (exitCode, signal) => {
    if (!closed) {
      const detail =
        signal === null
          ? `process exited with code ${exitCode}`
          : `process exited from signal ${signal}`;
      failFast(processClosedError(`closed: ${detail}`));
      return;
    }
    closed = true;
  });

  return {
    request({ method, params }: CodexAppServerClientRequest) {
      return Effect.gen(function* () {
        yield* ensureOpenEffect();
        const id = nextRequestId++;
        return yield* Effect.acquireUseRelease(
          acquirePendingResponse({
            id,
            method,
            pending,
            rememberCancelledSentRequest,
            requestTimeoutMs,
            runtimeId,
          }),
          ({ markWriteStarted, response }) =>
            Effect.gen(function* () {
              yield* sendRequestMessage(
                {
                  jsonrpc: "2.0",
                  id,
                  method,
                  ...(params !== undefined ? { params } : {}),
                },
                markWriteStarted,
              );
              return yield* response;
            }),
          ({ release }, exit) =>
            Effect.sync(() => release({ preserveLateResponse: Exit.isInterrupted(exit) })),
        );
      });
    },
    notify(notification) {
      return sendMessage({
        jsonrpc: "2.0",
        ...notification,
      });
    },
    drainNotifications() {
      return Effect.sync(() => notifications.splice(0));
    },
    drainServerRequests() {
      return Effect.sync(() => serverRequests.splice(0));
    },
    respond({ requestId, result, error }: Omit<CodexAppServerRespondInput, "runtimeId">) {
      return Effect.gen(function* () {
        if (result !== undefined && error !== undefined) {
          return yield* Effect.fail(
            new HostValidationError({
              message: `Codex app-server response for runtime ${runtimeId} cannot include both result and error`,
              details: { runtimeId, requestId },
            }),
          );
        }
        if (result === undefined && error === undefined) {
          return yield* Effect.fail(
            new HostValidationError({
              message: `Codex app-server response for runtime ${runtimeId} must include either result or error`,
              details: { runtimeId, requestId },
            }),
          );
        }
        yield* sendMessage({
          jsonrpc: "2.0",
          id: requestId,
          ...(result !== undefined ? { result } : {}),
          ...(error !== undefined ? { error } : {}),
        });
      });
    },
    close() {
      return Effect.sync(() => {
        closed = true;
        if (!stdoutClosed) {
          lines.close();
        }
        if (!stderrClosed) {
          stderrLines.close();
        }
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        for (const timeout of cancelledSentRequests.values()) {
          clearTimeout(timeout);
        }
        cancelledSentRequests.clear();
        for (const [id, request] of pending) {
          clearTimeout(request.timeout);
          request.reject(
            new HostResourceError({
              resource: "codexAppServerTransport",
              operation: "codexAppServerTransport.close",
              message: `Codex app-server transport for runtime ${runtimeId} is closed`,
              details: { runtimeId, requestId: id },
            }),
          );
          pending.delete(id);
        }
      });
    },
  };
};
