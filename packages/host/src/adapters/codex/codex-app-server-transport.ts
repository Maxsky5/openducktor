import type { ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
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
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
};

export type CodexAppServerStreamEvent = {
  runtimeId: string;
  kind: "notification" | "server_request";
  message: unknown;
};

export type CodexAppServerEventEmitter = (event: CodexAppServerStreamEvent) => void;

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const writeLine = (stdin: Writable, payload: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

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
      throw new Error(`Codex app-server transport for runtime ${runtimeId} is closed`);
    }
  };

  const sendMessage = async (message: Record<string, unknown>): Promise<void> => {
    ensureOpen();
    try {
      await writeLine(child.stdin, message);
    } catch (error) {
      throw new Error(`Failed writing Codex app-server message for runtime ${runtimeId}`, {
        cause: error,
      });
    }
  };

  const resolveResponse = (id: number, message: Record<string, unknown>): void => {
    const request = pending.get(id);
    if (!request) {
      failFast(
        new Error(`Received Codex app-server response with unexpected id ${id} for ${runtimeId}`),
      );
      return;
    }
    pending.delete(id);
    clearTimeout(request.timeout);

    if ("error" in message) {
      request.reject(
        new Error(
          `Codex app-server request ${request.method} failed for runtime ${runtimeId}: ${extractErrorMessage(
            message.error,
          )}`,
        ),
      );
      return;
    }
    if (!("result" in message)) {
      request.reject(
        new Error(
          `Codex app-server response ${id} for runtime ${runtimeId} is missing result or error`,
        ),
      );
      return;
    }
    request.resolve(message.result);
  };

  const handleMessage = (message: unknown): void => {
    if (!isJsonRecord(message)) {
      failFast(new Error(`Codex app-server stdout message for ${runtimeId} must be an object`));
      return;
    }

    const id = typeof message.id === "number" ? message.id : null;
    const hasMethod = typeof message.method === "string";
    const hasResponse = "result" in message || "error" in message;

    if (hasResponse) {
      if (id === null) {
        failFast(new Error(`Codex app-server response for ${runtimeId} is missing a numeric id`));
        return;
      }
      resolveResponse(id, message);
      return;
    }

    if (hasMethod && id === null) {
      if (eventEmitter) {
        eventEmitter({ runtimeId, kind: "notification", message });
      } else {
        notifications.push(message);
      }
      return;
    }

    if (hasMethod && id !== null) {
      if (eventEmitter) {
        eventEmitter({ runtimeId, kind: "server_request", message });
      } else {
        serverRequests.push(message);
      }
      return;
    }

    failFast(new Error(`Codex app-server stdout message for ${runtimeId} is not valid JSON-RPC`));
  };

  const lines = createInterface({ input: child.stdout });
  const waitForStdoutClose = new Promise<void>((resolve) => {
    lines.once("close", () => resolve());
  });
  lines.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      handleMessage(JSON.parse(trimmed));
    } catch (error) {
      failFast(
        new Error(`Invalid Codex app-server JSON on stdout for runtime ${runtimeId}: ${trimmed}`, {
          cause: error,
        }),
      );
    }
  });
  lines.on("close", () => {
    stdoutClosed = true;
    if (!closed) {
      failFast(new Error(`Codex app-server stdout closed unexpectedly for runtime ${runtimeId}`));
    }
  });
  const stderrLines = createInterface({ input: child.stderr });
  const waitForStderrClose = new Promise<void>((resolve) => {
    stderrLines.once("close", () => resolve());
  });
  stderrLines.on("line", () => {});
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
      failFast(new Error(`Codex app-server closed for runtime ${runtimeId}: ${detail}`));
      return;
    }
    closed = true;
  });

  return {
    async request({ method, params }: Omit<CodexAppServerRequestInput, "runtimeId">) {
      ensureOpen();
      const id = nextRequestId++;
      const result = new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(
              `Timed out waiting for Codex app-server request ${method} on runtime ${runtimeId} after ${requestTimeoutMs}ms`,
            ),
          );
        }, requestTimeoutMs);
        pending.set(id, { method, timeout, resolve, reject });
      });
      await sendMessage({
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      });
      return result;
    },
    async notify(method, params) {
      await sendMessage({
        jsonrpc: "2.0",
        method,
        ...(params !== undefined ? { params } : {}),
      });
    },
    async drainNotifications() {
      return notifications.splice(0);
    },
    async drainServerRequests() {
      return serverRequests.splice(0);
    },
    async respond({ requestId, result, error }: Omit<CodexAppServerRespondInput, "runtimeId">) {
      if (result !== undefined && error !== undefined) {
        throw new Error(
          `Codex app-server response for runtime ${runtimeId} cannot include both result and error`,
        );
      }
      if (result === undefined && error === undefined) {
        throw new Error(
          `Codex app-server response for runtime ${runtimeId} must include either result or error`,
        );
      }
      await sendMessage({
        jsonrpc: "2.0",
        id: requestId,
        ...(result !== undefined ? { result } : {}),
        ...(error !== undefined ? { error } : {}),
      });
    },
    async close() {
      closed = true;
      if (!stdoutClosed) {
        lines.close();
      }
      if (!stderrClosed) {
        stderrLines.close();
      }
      child.stdin.destroy();
      for (const [id, request] of pending) {
        clearTimeout(request.timeout);
        request.reject(new Error(`Codex app-server transport for runtime ${runtimeId} is closed`));
        pending.delete(id);
      }
      await Promise.all([waitForStdoutClose, waitForStderrClose]);
    },
  };
};
