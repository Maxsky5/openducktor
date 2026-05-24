import type { ChildProcessByStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { Effect, Fiber } from "effect";
import type { CodexAppServerProtocolMessage } from "../../ports/codex-app-server-port";
import { createCodexAppServerTransport } from "./codex-app-server-transport";

const createChild = (
  stdin: Writable = new PassThrough(),
): ChildProcessByStdio<Writable, PassThrough, PassThrough> => {
  const child = new EventEmitter() as ChildProcessByStdio<Writable, PassThrough, PassThrough>;
  child.stdin = stdin;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
};

const waitForStreamEvents = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const recordClearTimeouts = () => {
  const originalClearTimeout = globalThis.clearTimeout;
  const clearedTimeouts: ReturnType<typeof globalThis.setTimeout>[] = [];

  globalThis.clearTimeout = ((timeoutId: ReturnType<typeof globalThis.setTimeout>) => {
    clearedTimeouts.push(timeoutId);
    originalClearTimeout(timeoutId);
  }) as typeof globalThis.clearTimeout;

  return {
    clearedTimeouts,
    restore() {
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
};

describe("createCodexAppServerTransport", () => {
  test("keeps emitted notifications drainable after a request response", async () => {
    const child = createChild();
    const emitted: unknown[] = [];
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, (event) =>
      emitted.push(event),
    );
    const response = Effect.runPromise(
      transport.request({
        method: "model/list",
        params: {},
      }),
    );
    const notification = {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: {
            totalTokens: 10,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 10,
            reasoningOutputTokens: 0,
          },
          total: {
            totalTokens: 10,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 10,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 200,
        },
      },
    } satisfies CodexAppServerProtocolMessage;

    child.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { data: [], nextCursor: null } })}\n`,
    );
    child.stdout.write(`${JSON.stringify(notification)}\n`);

    await expect(response).resolves.toEqual({ data: [], nextCursor: null });
    expect(emitted).toEqual([
      { runtimeId: "runtime-1", kind: "notification", message: notification },
    ]);
    await expect(Effect.runPromise(transport.drainNotifications())).resolves.toEqual([
      notification,
    ]);

    await Effect.runPromise(transport.close());
  });

  test("accepts thread settings update notifications from Codex app-server", async () => {
    const child = createChild();
    const emitted: unknown[] = [];
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, (event) =>
      emitted.push(event),
    );
    const notification = {
      method: "thread/settings/updated",
      params: {
        threadId: "thread-1",
        settings: {
          model: "gpt-5",
        },
      },
    } satisfies CodexAppServerProtocolMessage;

    child.stdout.write(`${JSON.stringify(notification)}\n`);
    await waitForStreamEvents();

    expect(emitted).toEqual([
      { runtimeId: "runtime-1", kind: "notification", message: notification },
    ]);
    await expect(Effect.runPromise(transport.drainNotifications())).resolves.toEqual([
      notification,
    ]);

    await Effect.runPromise(transport.close());
  });

  test("does not retain emitted server requests for later drain polling", async () => {
    const child = createChild();
    const emitted: unknown[] = [];
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, (event) =>
      emitted.push(event),
    );
    const request = {
      id: 1,
      method: "execCommandApproval",
      params: {
        conversationId: "thread-1",
        callId: "call-1",
        approvalId: null,
        command: ["true"],
        cwd: "/repo",
        reason: null,
        parsedCmd: [],
      },
    };

    child.stdout.write(`${JSON.stringify(request)}\n`);

    expect(emitted).toEqual([{ runtimeId: "runtime-1", kind: "server_request", message: request }]);
    await expect(Effect.runPromise(transport.drainServerRequests())).resolves.toEqual([]);

    await Effect.runPromise(transport.close());
  });

  test("bounds captured stderr bytes used in process-close diagnostics", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000);

    child.stderr.write("first-error-line\n");
    child.stderr.write(`${"é".repeat(40 * 1024)}\n`);
    child.stderr.write("latest-error-line\n");
    await waitForStreamEvents();
    child.emit("close", 1, null);

    await expect(
      Effect.runPromise(transport.request({ method: "model/list", params: {} })),
    ).rejects.toThrow(
      /Codex app-server closed: process exited with code 1 for runtime runtime-1: .*latest-error-line/s,
    );
    await expect(
      Effect.runPromise(transport.request({ method: "model/list", params: {} })),
    ).rejects.not.toThrow("first-error-line");
  });

  test("clears the pending request timeout when interrupted during send", async () => {
    let writeCount = 0;
    const stdin = new Writable({
      write(_chunk, _encoding, _callback) {
        writeCount += 1;
      },
    });
    const child = createChild(stdin);
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000);
    const clearTimeoutRecorder = recordClearTimeouts();

    try {
      const fiber = Effect.runFork(
        transport.request({
          method: "model/list",
          params: {},
        }),
      );
      await waitForStreamEvents();

      expect(writeCount).toBe(1);

      await Effect.runPromise(Fiber.interrupt(fiber));

      expect(clearTimeoutRecorder.clearedTimeouts).toHaveLength(1);
    } finally {
      clearTimeoutRecorder.restore();
      await Effect.runPromise(transport.close());
    }
  });

  test("keeps the transport usable after a late response to an interrupted sent request", async () => {
    let writeCount = 0;
    const stdin = {
      write(_chunk: string, callback: (error?: Error | null) => void) {
        writeCount += 1;
        if (writeCount > 1) {
          callback();
        }
        return true;
      },
      destroy() {},
    } as unknown as Writable;
    const child = createChild(stdin);
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000);

    try {
      const interruptedFiber = Effect.runFork(
        transport.request({
          method: "model/list",
          params: {},
        }),
      );
      await waitForStreamEvents();

      expect(writeCount).toBe(1);

      await Effect.runPromise(Fiber.interrupt(interruptedFiber));
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { data: [], nextCursor: null } })}\n`,
      );
      await waitForStreamEvents();

      const nextResponse = Effect.runPromise(
        transport.request({
          method: "model/list",
          params: {},
        }),
      );
      await waitForStreamEvents();
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { data: [], nextCursor: null } })}\n`,
      );

      await expect(nextResponse).resolves.toEqual({ data: [], nextCursor: null });
    } finally {
      await Effect.runPromise(transport.close());
    }
  });

  test("still fails fast for responses with genuinely unexpected ids", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000);

    try {
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 99, result: { data: [], nextCursor: null } })}\n`,
      );
      await waitForStreamEvents();

      await expect(
        Effect.runPromise(
          transport.request({
            method: "model/list",
            params: {},
          }),
        ),
      ).rejects.toThrow("Received Codex app-server response with unexpected id 99 for runtime-1");
    } finally {
      await Effect.runPromise(transport.close());
    }
  });

  test("clears the pending request timeout when send fails", async () => {
    const stdin = {
      write(_chunk: string, callback: (error?: Error | null) => void) {
        callback(new Error("write failed"));
        return false;
      },
      destroy() {},
    } as unknown as Writable;
    const child = createChild(stdin);
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000);
    const clearTimeoutRecorder = recordClearTimeouts();

    try {
      await expect(
        Effect.runPromise(
          transport.request({
            method: "model/list",
            params: {},
          }),
        ),
      ).rejects.toThrow("Failed writing Codex app-server message for runtime runtime-1");

      expect(clearTimeoutRecorder.clearedTimeouts).toHaveLength(1);
    } finally {
      clearTimeoutRecorder.restore();
      await Effect.runPromise(transport.close());
    }
  });

  test("clears the pending request timeout when serialization fails", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000);
    const clearTimeoutRecorder = recordClearTimeouts();
    const circularParams: Record<string, unknown> = {};
    circularParams.self = circularParams;

    try {
      await expect(
        Effect.runPromise(
          transport.request({
            method: "model/list",
            params: circularParams as never,
          }),
        ),
      ).rejects.toThrow("Failed writing Codex app-server message for runtime runtime-1");

      expect(clearTimeoutRecorder.clearedTimeouts).toHaveLength(1);

      const nextResponse = Effect.runPromise(
        transport.request({
          method: "model/list",
          params: {},
        }),
      );
      await waitForStreamEvents();
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { data: [], nextCursor: null } })}\n`,
      );

      await expect(nextResponse).resolves.toEqual({ data: [], nextCursor: null });
    } finally {
      clearTimeoutRecorder.restore();
      await Effect.runPromise(transport.close());
    }
  });
});
