import type { ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  CodexAppServerRequestInput,
  CodexAppServerRespondInput,
} from "../../ports/codex-app-server-port";
import type { CodexAppServerTransport } from "./codex-app-server-transport-registry";

type CodexChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;

type PendingRequest = {
  method: string;
  timeout: NodeJS.Timeout;
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type CodexAppServerChildTransport = CodexAppServerTransport & {
  notify(method: string, params?: unknown): Effect.Effect<void, CodexAppServerTransportError>;
  close(): Effect.Effect<void, never>;
};

export type CodexAppServerTransportError =
  | HostOperationError
  | HostResourceError
  | HostValidationError;

export type CodexAppServerStreamEvent = {
  runtimeId: string;
  kind: "notification" | "server_request";
  message: unknown;
};

export type CodexAppServerEventEmitter = (event: CodexAppServerStreamEvent) => void;

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MAX_BUFFERED_STREAM_MESSAGES = 1_000;
const MAX_CAPTURED_STDERR_BYTES = 64 * 1024;

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const writeLine = (stdin: Writable, payload: unknown) =>
  Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    catch: (cause) => toHostOperationError(cause, "codexAppServerTransport.writeLine"),
  });

const resolveAfterQueuedMessages = (resolve: (value: unknown) => void, value: unknown): void => {
  setImmediate(() => resolve(value));
};

const pushBoundedMessage = (messages: unknown[], message: unknown): void => {
  messages.push(message);
  if (messages.length > MAX_BUFFERED_STREAM_MESSAGES) {
    messages.splice(0, messages.length - MAX_BUFFERED_STREAM_MESSAGES);
  }
};

const appendCapturedStderr = (current: string, line: string): string => {
  const next = current.length > 0 ? `${current}\n${line}` : line;
  const encoded = Buffer.from(next, "utf8");
  if (encoded.byteLength <= MAX_CAPTURED_STDERR_BYTES) {
    return next;
  }
  return encoded.subarray(encoded.byteLength - MAX_CAPTURED_STDERR_BYTES).toString("utf8");
};

const extractErrorMessage = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (isJsonRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return JSON.stringify(value);
};

export const createCodexAppServerTransport = (
  runtimeId: string,
  child: CodexChildProcess,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  eventEmitter?: CodexAppServerEventEmitter,
): CodexAppServerChildTransport => {
  let nextRequestId = 1;
  let closed = false;
  let fatalError: Error | null = null;
  const pending = new Map<number, PendingRequest>();
  const notifications: unknown[] = [];
  const serverRequests: unknown[] = [];
  let stderrOutput = "";
  let stdoutClosed = false;
  let stderrClosed = false;

  const failFast = (error: Error): void => {
    if (!fatalError) {
      fatalError = error;
    }
    closed = true;
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
      yield* writeLine(child.stdin, message).pipe(
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

  const waitForResponse = (id: number, method: string) =>
    Effect.async<unknown, HostOperationError | HostResourceError | HostValidationError>(
      (resume, signal) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          resume(
            Effect.fail(
              new HostOperationError({
                operation: `codexAppServerTransport.request.${method}`,
                message: `Timed out waiting for Codex app-server request ${method} on runtime ${runtimeId} after ${requestTimeoutMs}ms`,
                details: { runtimeId, method, requestTimeoutMs },
              }),
            ),
          );
        }, requestTimeoutMs);
        const abort = () => {
          clearTimeout(timeout);
          pending.delete(id);
          resume(
            Effect.fail(
              new HostOperationError({
                operation: `codexAppServerTransport.request.${method}`,
                message: `Codex app-server request ${method} was interrupted for runtime ${runtimeId}.`,
                details: { runtimeId, method },
              }),
            ),
          );
        };
        signal.addEventListener("abort", abort, { once: true });
        pending.set(id, {
          method,
          timeout,
          resolve: (value) => {
            signal.removeEventListener("abort", abort);
            resolveAfterQueuedMessages(
              (resolvedValue) => resume(Effect.succeed(resolvedValue)),
              value,
            );
          },
          reject: (error) => {
            signal.removeEventListener("abort", abort);
            resume(
              Effect.fail(
                toHostOperationError(error, `codexAppServerTransport.request.${method}`, {
                  runtimeId,
                  method,
                }),
              ),
            );
          },
        });
      },
    );

  const resolveResponse = (id: number, message: Record<string, unknown>): void => {
    const request = pending.get(id);
    if (!request) {
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
    request.resolve(message.result);
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

    const id = typeof message.id === "number" ? message.id : null;
    const hasMethod = typeof message.method === "string";
    const hasResponse = "result" in message || "error" in message;

    if (hasResponse) {
      if (id === null) {
        failFast(
          new HostValidationError({
            message: `Codex app-server response for ${runtimeId} is missing a numeric id`,
            field: "id",
            details: { runtimeId },
          }),
        );
        return;
      }
      resolveResponse(id, message);
      return;
    }

    if (hasMethod && id === null) {
      pushBoundedMessage(notifications, message);
      if (eventEmitter) {
        eventEmitter({ runtimeId, kind: "notification", message });
      }
      return;
    }

    if (hasMethod && id !== null) {
      if (eventEmitter) {
        eventEmitter({ runtimeId, kind: "server_request", message });
      } else {
        pushBoundedMessage(serverRequests, message);
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
    request({ method, params }: Omit<CodexAppServerRequestInput, "runtimeId">) {
      return Effect.gen(function* () {
        yield* ensureOpenEffect();
        const id = nextRequestId++;
        const response = waitForResponse(id, method);
        yield* sendMessage({
          jsonrpc: "2.0",
          id,
          method,
          ...(params !== undefined ? { params } : {}),
        });
        return yield* response;
      });
    },
    notify(method, params) {
      return sendMessage({
        jsonrpc: "2.0",
        method,
        ...(params !== undefined ? { params } : {}),
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
