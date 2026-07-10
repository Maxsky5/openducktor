import type { ChildProcessByStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { Effect, Fiber } from "effect";
import type {
  CodexAppServerProtocolMessage,
  CodexAppServerStreamEvent,
} from "../../ports/codex-app-server-port";
import type { CodexAppServerServerNotificationMethod } from "../../ports/codex-app-server-protocol";
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

const notificationEvent = (message: unknown) =>
  expect.objectContaining({
    runtimeId: "runtime-1",
    kind: "notification" as const,
    receivedAt: expect.any(String),
    message,
  });

const serverRequestEvent = (message: unknown) =>
  expect.objectContaining({
    runtimeId: "runtime-1",
    kind: "server_request" as const,
    receivedAt: expect.any(String),
    message,
  });

const receivedAtFrom = (event: unknown): string =>
  (event as Pick<CodexAppServerStreamEvent, "receivedAt">).receivedAt;

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
  test("keeps emitted notifications available as buffered events after a request response", async () => {
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
    expect(emitted).toEqual([notificationEvent(notification)]);
    const bufferedEvents = await Effect.runPromise(transport.takeBufferedEvents());
    expect(bufferedEvents).toEqual([notificationEvent(notification)]);
    expect(bufferedEvents[0]?.receivedAt).toBe(receivedAtFrom(emitted[0]));

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

    expect(emitted).toEqual([notificationEvent(notification)]);
    await expect(Effect.runPromise(transport.takeBufferedEvents())).resolves.toEqual([
      notificationEvent(notification),
    ]);

    await Effect.runPromise(transport.close());
  });

  test("keeps the transport usable after model safety buffering and unknown notifications", async () => {
    const child = createChild();
    const emitted: unknown[] = [];
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, (event) =>
      emitted.push(event),
    );
    const notification = {
      method: "model/safetyBuffering/updated" satisfies CodexAppServerServerNotificationMethod,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        model: "gpt-5",
        useCases: ["cyber"],
        reasons: ["user_risk"],
        showBufferingUi: true,
        fasterModel: "gpt-5-mini",
      },
    } satisfies CodexAppServerProtocolMessage;
    const unknownNotification = {
      method: "future/notification",
      params: {
        threadId: "thread-1",
      },
    } satisfies CodexAppServerProtocolMessage;

    try {
      child.stdout.write(`${JSON.stringify(notification)}\n`);
      child.stdout.write(`${JSON.stringify(unknownNotification)}\n`);
      await waitForStreamEvents();

      const nextResponse = Effect.runPromise(
        transport.request({
          method: "model/list",
          params: {},
        }),
      );
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { data: [], nextCursor: null } })}\n`,
      );

      expect(await nextResponse).toEqual({ data: [], nextCursor: null });
      expect(emitted).toEqual([
        notificationEvent(notification),
        notificationEvent(unknownNotification),
      ]);
    } finally {
      await Effect.runPromise(transport.close());
    }
  });

  test("still fails fast for unknown server requests", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000);

    try {
      child.stdout.write(
        `${JSON.stringify({ id: "request-1", method: "future/request", params: {} })}\n`,
      );
      await waitForStreamEvents();

      await expect(
        Effect.runPromise(
          transport.request({
            method: "model/list",
            params: {},
          }),
        ),
      ).rejects.toThrow(
        "Unsupported Codex app-server server request method for runtime-1: future/request",
      );
    } finally {
      await Effect.runPromise(transport.close());
    }
  });

  test("fails fast when a known server request is missing its id", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000);

    try {
      child.stdout.write(
        `${JSON.stringify({
          method: "item/permissions/requestApproval",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-1",
            startedAtMs: 1,
            cwd: "/repo",
            reason: null,
            permissions: {
              network: null,
              fileSystem: null,
            },
          },
        })}\n`,
      );
      await waitForStreamEvents();

      await expect(
        Effect.runPromise(
          transport.request({
            method: "model/list",
            params: {},
          }),
        ),
      ).rejects.toThrow("Codex app-server server request for runtime-1 is missing an id");
    } finally {
      await Effect.runPromise(transport.close());
    }
  });

  test("keeps emitted server requests available as buffered events until OpenDucktor responds", async () => {
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
    } satisfies CodexAppServerProtocolMessage;

    child.stdout.write(`${JSON.stringify(request)}\n`);

    expect(emitted).toEqual([serverRequestEvent(request)]);
    await expect(Effect.runPromise(transport.takeBufferedEvents())).resolves.toEqual([
      serverRequestEvent(request),
    ]);

    child.stdout.write(`${JSON.stringify(request)}\n`);
    await waitForStreamEvents();
    await Effect.runPromise(transport.respond({ requestId: 1, result: { decision: "denied" } }));
    await expect(Effect.runPromise(transport.takeBufferedEvents())).resolves.toEqual([]);

    await Effect.runPromise(transport.close());
  });

  test("drops buffered server requests when Codex reports them resolved before a reply", async () => {
    const child = createChild();
    const emitted: unknown[] = [];
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, (event) =>
      emitted.push(event),
    );
    const request = {
      id: "request-1",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        startedAtMs: 1,
        cwd: "/repo",
        reason: "Need permission for test",
        permissions: {
          network: null,
          fileSystem: null,
        },
      },
    } satisfies CodexAppServerProtocolMessage;
    const resolved = {
      method: "serverRequest/resolved",
      params: {
        threadId: "thread-1",
        requestId: "request-1",
      },
    } satisfies CodexAppServerProtocolMessage;

    child.stdout.write(`${JSON.stringify(request)}\n`);
    await waitForStreamEvents();
    child.stdout.write(`${JSON.stringify(resolved)}\n`);
    await waitForStreamEvents();

    expect(emitted).toEqual([serverRequestEvent(request), notificationEvent(resolved)]);
    await expect(Effect.runPromise(transport.takeBufferedEvents())).resolves.toEqual([
      notificationEvent(resolved),
    ]);

    await Effect.runPromise(transport.close());
  });

  test("matches buffered server request ids by JSON-RPC id type", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000);
    const stringRequest = {
      id: "53",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-string",
        startedAtMs: 1,
        cwd: "/repo",
        reason: null,
        permissions: {
          network: null,
          fileSystem: null,
        },
      },
    } satisfies CodexAppServerProtocolMessage;
    const numericRequest = {
      ...stringRequest,
      id: 53,
      params: {
        ...stringRequest.params,
        itemId: "item-number",
      },
    } satisfies CodexAppServerProtocolMessage;
    const resolvedNumericRequest = {
      method: "serverRequest/resolved",
      params: {
        threadId: "thread-1",
        requestId: 53,
      },
    } satisfies CodexAppServerProtocolMessage;

    child.stdout.write(`${JSON.stringify(stringRequest)}\n`);
    child.stdout.write(`${JSON.stringify(numericRequest)}\n`);
    await waitForStreamEvents();
    child.stdout.write(`${JSON.stringify(resolvedNumericRequest)}\n`);
    await waitForStreamEvents();

    await expect(Effect.runPromise(transport.takeBufferedEvents())).resolves.toEqual([
      serverRequestEvent(stringRequest),
      notificationEvent(resolvedNumericRequest),
    ]);

    await Effect.runPromise(transport.close());
  });

  test("accepts permissions approval requests without an optional reason", async () => {
    const child = createChild();
    const emitted: unknown[] = [];
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, (event) =>
      emitted.push(event),
    );
    const request = {
      id: 1,
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        startedAtMs: 1,
        cwd: "/repo",
        permissions: {
          network: null,
          fileSystem: null,
        },
      },
    };

    child.stdout.write(`${JSON.stringify(request)}\n`);

    expect(emitted).toEqual([serverRequestEvent(request)]);

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
