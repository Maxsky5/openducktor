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
  CodexAppServerStreamEvent,
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
  CodexChildProcess,
  PendingCodexAppServerRequest,
} from "./codex-app-server-transport-types";
import { writeJsonLine } from "./codex-json-line-writer";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
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
  const bufferedEvents: CodexAppServerStreamEvent[] = [];
  let stderrOutput = "";
  let stdoutClosed = false;
  let stderrClosed = false;
  let unexpectedStdoutCloseTimer: ReturnType<typeof setTimeout> | null = null;

  const clearCancelledSentRequests = (): void => {
    for (const timeout of cancelledSentRequests.values()) {
      clearTimeout(timeout);
    }
    cancelledSentRequests.clear();
  };

  const clearUnexpectedStdoutCloseTimer = (): void => {
    if (unexpectedStdoutCloseTimer === null) {
      return;
    }
    clearTimeout(unexpectedStdoutCloseTimer);
    unexpectedStdoutCloseTimer = null;
  };

  const failFast = (error: Error): void => {
    if (!fatalError) {
      fatalError = error;
    }
    closed = true;
    clearCancelledSentRequests();
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
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
    const timeout = setTimeout(() => {
      cancelledSentRequests.delete(id);
    }, requestTimeoutMs);
    cancelledSentRequests.set(id, timeout);
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
  const emitBufferedEvent = (event: CodexAppServerStreamEvent) => {
    pushBoundedMessage(bufferedEvents, event);
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

  const forgetServerRequest = (requestId: string | number): void => {
    const index = bufferedEvents.findIndex(
      (event) =>
        event.kind === "server_request" &&
        isJsonRecord(event.message) &&
        "id" in event.message &&
        event.message.id === requestId,
    );
    if (index >= 0) {
      bufferedEvents.splice(index, 1);
    }
  };

  const forgetResolvedServerRequest = ({ method, params }: CodexAppServerProtocolMessage): void => {
    if (method === "serverRequest/resolved" && isJsonRecord(params)) {
      const requestId = params.requestId ?? params.request_id;
      if (typeof requestId === "number" || typeof requestId === "string") {
        forgetServerRequest(requestId);
      }
    }
  };
  const rejectPendingRequests = (operation: string, message: string): void => {
    clearCancelledSentRequests();
    for (const [id, request] of pending) {
      request.reject(
        new HostResourceError({
          resource: "codexAppServerTransport",
          operation,
          message,
          details: { runtimeId, requestId: id },
        }),
      );
    }
    pending.clear();
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
        const notification = parseStreamMessage(runtimeId, message, "notification");
        forgetResolvedServerRequest(notification);
        emitBufferedEvent({
          runtimeId,
          kind: "notification",
          message: notification,
        });
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
        emitBufferedEvent({
          runtimeId,
          kind: "server_request",
          message: parseStreamMessage(runtimeId, message, "server_request"),
        });
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
    unexpectedStdoutCloseTimer = setTimeout(() => {
      unexpectedStdoutCloseTimer = null;
      if (!closed && !fatalError) {
        failFast(processClosedError("stdout closed unexpectedly"));
      }
    }, 25);
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
    clearUnexpectedStdoutCloseTimer();
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
    takeBufferedEvents() {
      return Effect.sync(() => bufferedEvents.splice(0));
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
        forgetServerRequest(requestId);
        yield* sendMessage({
          jsonrpc: "2.0",
          id: requestId,
          ...(result !== undefined ? { result } : {}),
          ...(error !== undefined ? { error } : {}),
        });
      });
    },
    rejectPendingRequestsForShutdown() {
      return Effect.sync(() =>
        rejectPendingRequests(
          "codexAppServerTransport.rejectPendingRequestsForShutdown",
          `Codex app-server transport for runtime ${runtimeId} is shutting down`,
        ),
      );
    },
    close() {
      return Effect.sync(() => {
        clearUnexpectedStdoutCloseTimer();
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
        rejectPendingRequests(
          "codexAppServerTransport.close",
          `Codex app-server transport for runtime ${runtimeId} is closed`,
        );
      });
    },
  };
};
