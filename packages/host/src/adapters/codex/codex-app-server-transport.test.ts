import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { Effect, Fiber } from "effect";
import type { CodexAppServerProtocolMessage } from "../../ports/codex-app-server-port";
import type { CodexAppServerServerNotificationMethod } from "../../ports/codex-app-server-protocol";
import { HostValidationError } from "../../effect/host-errors";
import { createCodexAppServerTransport } from "./codex-app-server-transport";
import type { CodexChildProcess } from "./codex-app-server-transport-types";

type TestCodexChildProcess = CodexChildProcess & {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  emit(event: "close", exitCode: number | null, signal: NodeJS.Signals | null): boolean;
};

type PendingWriteState = {
  complete?: () => void;
};

const createChild = (stdin: Writable = new PassThrough()): TestCodexChildProcess => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return Object.assign(new EventEmitter(), { stdin, stdout, stderr });
};

const waitForStreamEvents = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const notificationEvent = (message: CodexAppServerProtocolMessage) =>
  expect.objectContaining({
    runtimeId: "runtime-1",
    kind: "notification" as const,
    receivedAt: expect.any(String),
    message,
  });

const serverRequestEvent = (message: CodexAppServerProtocolMessage) =>
  expect.objectContaining({
    runtimeId: "runtime-1",
    kind: "server_request" as const,
    receivedAt: expect.any(String),
    message,
  });

describe("createCodexAppServerTransport", () => {
  test("rejects malformed JSON-valid model list results with HostValidationError", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, () => {});

    try {
      const failure = Effect.runPromise(
        Effect.flip(
          transport.request({
            method: "model/list",
            params: {},
          }),
        ),
      );
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { data: [], nextCursor: 1 } })}\n`,
      );

      await expect(failure).resolves.toBeInstanceOf(HostValidationError);
    } finally {
      await Effect.runPromise(transport.close());
    }
  });

  test("delivers notifications to the prepared event sink after a request response", async () => {
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

  test("responds to current time requests in whole Unix seconds and stays usable", async () => {
    const stdin = new PassThrough();
    let written = "";
    stdin.on("data", (chunk) => {
      written += String(chunk);
    });
    const child = createChild(stdin);
    const emitted: unknown[] = [];
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, (event) =>
      emitted.push(event),
    );
    const before = Math.floor(Date.now() / 1_000);

    try {
      child.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "current-time-1",
          method: "currentTime/read",
          params: { threadId: "thread-1" },
        })}\n`,
      );
      await waitForStreamEvents();
      const after = Math.floor(Date.now() / 1_000);
      const responseMatch = written.match(
        /^\{"jsonrpc":"2\.0","id":"current-time-1","result":\{"currentTimeAt":(\d+)}}\n$/,
      );

      expect(responseMatch).not.toBeNull();
      if (!responseMatch) {
        throw new Error("Codex current time response did not match the protocol shape.");
      }
      const currentTimeAt = Number(responseMatch[1]);
      expect(Number.isInteger(currentTimeAt)).toBe(true);
      expect(currentTimeAt).toBeGreaterThanOrEqual(before);
      expect(currentTimeAt).toBeLessThanOrEqual(after);
      expect(emitted).toEqual([]);

      const nextResponse = Effect.runPromise(
        transport.request({
          method: "model/list",
          params: {},
        }),
      );
      await waitForStreamEvents();
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { data: [], nextCursor: null } })}\n`,
      );

      await expect(nextResponse).resolves.toEqual({ data: [], nextCursor: null });
    } finally {
      await Effect.runPromise(transport.close());
    }
  });

  test("fails actionably when current time request params omit the thread id", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, () => {});

    try {
      child.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "current-time-1",
          method: "currentTime/read",
          params: {},
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
      ).rejects.toThrow(
        "Codex app-server currentTime/read request for runtime-1 has invalid params",
      );
    } finally {
      await Effect.runPromise(transport.close());
    }
  });

  test("still fails fast for unknown server requests", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, () => {});

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
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, () => {});

    try {
      child.stdout.write(
        `${JSON.stringify({
          method: "item/permissions/requestApproval",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-1",
            environmentId: null,
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

  test("delivers every server-request occurrence directly to the prepared event sink", async () => {
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

    child.stdout.write(`${JSON.stringify(request)}\n`);
    await waitForStreamEvents();
    await Effect.runPromise(
      transport.respond({
        requestId: 1,
        result: { decision: { denied: { rejection: "Rejected in test." } } },
      }),
    );
    expect(emitted).toEqual([serverRequestEvent(request), serverRequestEvent(request)]);

    await Effect.runPromise(transport.close());
  });

  test("delivers server-request resolution notifications in transport order", async () => {
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
        environmentId: null,
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

    await Effect.runPromise(transport.close());
  });

  test("preserves JSON-RPC id types when delivering ordered events", async () => {
    const child = createChild();
    const emitted: unknown[] = [];
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, (event) =>
      emitted.push(event),
    );
    const stringRequest = {
      id: "53",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-string",
        environmentId: null,
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

    expect(emitted).toEqual([
      serverRequestEvent(stringRequest),
      serverRequestEvent(numericRequest),
      notificationEvent(resolvedNumericRequest),
    ]);

    await Effect.runPromise(transport.close());
  });

  test("delivers permissions approval requests with the complete v2 payload", async () => {
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
        environmentId: null,
        startedAtMs: 1,
        cwd: "/repo",
        reason: null,
        permissions: {
          network: null,
          fileSystem: null,
        },
      },
    } satisfies CodexAppServerProtocolMessage;

    child.stdout.write(`${JSON.stringify(request)}\n`);

    expect(emitted).toEqual([serverRequestEvent(request)]);

    await Effect.runPromise(transport.close());
  });

  test("bounds captured stderr bytes used in process-close diagnostics", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, () => {});

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

  test("keeps the transport usable after a late response to an interrupted sent request", async () => {
    let writeCount = 0;
    const firstWriteState: PendingWriteState = {};
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        writeCount += 1;
        if (writeCount === 1) {
          firstWriteState.complete = callback;
          return;
        }
        callback();
      },
    });
    const child = createChild(stdin);
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, () => {});

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
      const completeFirstWrite = firstWriteState.complete;
      if (!completeFirstWrite) {
        throw new Error("Expected the interrupted request write to remain pending.");
      }
      completeFirstWrite();
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
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, () => {});

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

  test("fails the request when send fails", async () => {
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("write failed"));
      },
    });
    const child = createChild(stdin);
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, () => {});
    try {
      await expect(
        Effect.runPromise(
          transport.request({
            method: "model/list",
            params: {},
          }),
        ),
      ).rejects.toThrow("Failed writing Codex app-server message for runtime runtime-1");
    } finally {
      await Effect.runPromise(transport.close());
    }
  });

  test("keeps the transport usable when serialization fails", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, () => {});
    const circularParams: Record<string, unknown> = {};
    circularParams.self = circularParams;

    try {
      await expect(
        Effect.runPromise(
          transport.request({
            method: "model/list",
            params: circularParams,
          }),
        ),
      ).rejects.toThrow("Failed writing Codex app-server message for runtime runtime-1");

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
});
