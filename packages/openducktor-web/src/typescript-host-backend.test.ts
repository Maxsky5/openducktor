import { describe, expect, mock, test } from "bun:test";
import {
  CodexSessionHistoryError,
  createLocalAttachmentAdapter,
  type EffectHostCommandRouter,
  TaskAssetError,
  type TaskAssetReadService,
  TerminalServiceError,
} from "@openducktor/host";
import type { HostEventEnvelope } from "@openducktor/contracts";
import { Effect } from "effect";
import { WorkspaceTextFileWriteError } from "../../host/src/application/filesystem/workspace-text-file-service";
import type { WebLogger } from "./logger";
import { createTaskEventLeaseManager, type TaskEventLeaseManager } from "./task-event-leases";
import {
  BufferedHostEventBus,
  stopTypescriptHostBackendServices,
  validateWebFrontendOrigin,
} from "./typescript-host-backend-support";
import type { JsonValue, TaskEventStreamFrame } from "@openducktor/contracts";

const nativeResponse = await Bun.fetch("data:,");
// SAFETY: This test controls the fixture and supplies the asserted shape used by this case.
(globalThis as typeof globalThis & { Response: typeof Response }).Response =
  nativeResponse.constructor as typeof Response;

const { handleTypescriptHostBackendRequest, resolveAppSessionCookieName } =
  await import("./typescript-host-backend");

const APP_TOKEN = "app-token";
const APP_SESSION_COOKIE_NAME = "openducktor_web_session";
const CONTROL_TOKEN = "control-token";
const DEVELOPMENT_INSTANCE_ID = "browser-0123456789ab";
const DEVELOPMENT_APP_SESSION_COOKIE_NAME = `${APP_SESSION_COOKIE_NAME}_${DEVELOPMENT_INSTANCE_ID}`;
const testLogger: WebLogger = {
  error: () => Effect.void,
  info: () => Effect.void,
  success: () => Effect.void,
};

class StructuredHostCommandFailure extends Error {
  readonly details: { readonly command: string; readonly failureKind: "timeout" };

  constructor(command: string) {
    super(`Failed to invoke ${command}.`);
    this.name = "StructuredHostCommandFailure";
    this.details = { command, failureKind: "timeout" };
  }
}

type TestHostCommandInvoke = (
  command: string,
  args?: Record<string, JsonValue>,
) => Effect.Effect<unknown, unknown>;

const createDeferred = <Value = void>() => {
  let resolve: (value: Value | PromiseLike<Value>) => void = () => {};
  const promise = new Promise<Value>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const PENDING_STREAM_READ = Symbol("pending-stream-read");
type StreamReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

const readImmediateStreamChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<StreamReadResult> => {
  const readPromise = reader.read().then((value): StreamReadResult => value);
  await Promise.resolve();
  const result = await Promise.race([readPromise, Promise.resolve(PENDING_STREAM_READ)]);
  if (result === PENDING_STREAM_READ) {
    await reader.cancel();
    throw new Error("Expected the SSE response to flush an initial frame immediately.");
  }

  return result;
};

// SAFETY: This test controls the fixture and supplies `ReturnType<EffectHostCommandRouter["invoke"]>` used by this case.
const createTestHostCommandRouter = (
  invoke: TestHostCommandInvoke = () => Effect.succeed(null),
): EffectHostCommandRouter => ({
  dispose: () => Effect.void,
  initialize: () => Effect.void,
  invoke: (command, args) => invoke(command, args) as ReturnType<EffectHostCommandRouter["invoke"]>,
});

const missingTaskAssetReadService: TaskAssetReadService = {
  read: () => Effect.succeed(null),
  readBatch: () => Effect.succeed({ kind: "missing", assetIds: [] }),
};

type TestRequestOptions = Partial<{
  appSessionCookieName: string;
  appToken: string;
  controlToken: string;
  eventBus: BufferedHostEventBus;
  hostCommandRouter: EffectHostCommandRouter;
  taskAssetReadService: TaskAssetReadService;
  beginShutdown: () => void;
  shutdownStarted: boolean;
  stop: () => Promise<void>;
  taskEventLeaseManager: TaskEventLeaseManager;
}>;

const handleTestRequest = (
  request: Request,
  options: TestRequestOptions = {},
): Promise<Response> => {
  const hostCommandRouter = options.hostCommandRouter ?? createTestHostCommandRouter();
  return Effect.runPromise(
    handleTypescriptHostBackendRequest({
      allowedOrigins: new Set(),
      appSessionCookieName: options.appSessionCookieName ?? APP_SESSION_COOKIE_NAME,
      appToken: options.appToken ?? APP_TOKEN,
      controlToken: options.controlToken ?? CONTROL_TOKEN,
      eventBus: options.eventBus ?? new BufferedHostEventBus({ report: () => {} }),
      hostCommandRouter,
      ...(() => {
        if (options.taskEventLeaseManager) {
          return { taskEventLeaseManager: options.taskEventLeaseManager };
        }
        return {};
      })(),
      taskAssetReadService: options.taskAssetReadService ?? missingTaskAssetReadService,
      localAttachments: createLocalAttachmentAdapter(),
      logger: testLogger,
      request,
      shutdownStarted: options.shutdownStarted ?? false,
      beginShutdown: options.beginShutdown ?? (() => {}),
      stop: options.stop ?? (async () => {}),
    }),
  );
};

describe("TypeScript web host backend", () => {
  test("uses one session cookie name per development instance", () => {
    expect(
      resolveAppSessionCookieName("development", {
        OPENDUCKTOR_DEV_INSTANCE: DEVELOPMENT_INSTANCE_ID,
      }),
    ).toBe(DEVELOPMENT_APP_SESSION_COOKIE_NAME);
    expect(
      resolveAppSessionCookieName("development", {
        OPENDUCKTOR_DEV_INSTANCE: "browser-fedcba987654",
      }),
    ).toBe(`${APP_SESSION_COOKIE_NAME}_browser-fedcba987654`);
    expect(
      resolveAppSessionCookieName("production", {
        OPENDUCKTOR_DEV_INSTANCE: DEVELOPMENT_INSTANCE_ID,
      }),
    ).toBe(APP_SESSION_COOKIE_NAME);
  });

  test("serves health and development session routes without opening a server", async () => {
    const health = await handleTestRequest(new Request("http://127.0.0.1/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const session = await handleTestRequest(
      new Request("http://127.0.0.1/session", {
        method: "POST",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      { appSessionCookieName: DEVELOPMENT_APP_SESSION_COOKIE_NAME },
    );
    expect(session.status).toBe(200);
    expect(session.headers.get("set-cookie")).toContain(
      `${DEVELOPMENT_APP_SESSION_COOKIE_NAME}=${APP_TOKEN}`,
    );
  });

  test("rejects invalid browser frontend origins before opening a host port", () => {
    expect(() => validateWebFrontendOrigin("https://127.0.0.1:1420")).toThrow(
      "browser frontend origin must use http",
    );
    expect(() => validateWebFrontendOrigin("http://example.com:1420")).toThrow(
      "browser frontend origin must target 127.0.0.1, localhost, or [::1]",
    );
  });

  test("preserves structured host command failure kind in invoke error responses", async () => {
    const hostCommandRouter = createTestHostCommandRouter((command) =>
      Effect.fail(new StructuredHostCommandFailure(command)),
    );

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/invoke/runtime_ensure", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({}),
      }),
      { hostCommandRouter },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to invoke runtime_ensure.",
      failureKind: "timeout",
      message: "Failed to invoke runtime_ensure.",
    });
  });

  test("rejects malformed successful command results before JSON serialization", async () => {
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/invoke/runtime_ensure", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({}),
      }),
      {
        hostCommandRouter: createTestHostCommandRouter(() =>
          Effect.succeed({ runtimeId: "runtime-1" }),
        ),
      },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Host command 'runtime_ensure' returned an invalid response.",
      message: "Host command 'runtime_ensure' returned an invalid response.",
    });
  });

  test("preserves structured terminal failures in invoke error responses", async () => {
    const hostCommandRouter = createTestHostCommandRouter(() =>
      Effect.fail(
        new TerminalServiceError({
          code: "unsupported_runtime",
          operation: "create",
          message: "Interactive terminals are unavailable in this runtime.",
          workingDir: "/repo/worktree",
        }),
      ),
    );

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/invoke/terminal_create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({ workingDir: "/repo/worktree", context: {} }),
      }),
      { hostCommandRouter },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Interactive terminals are unavailable in this runtime.",
      message: "Interactive terminals are unavailable in this runtime.",
      failure: {
        kind: "terminal",
        terminalFailure: {
          code: "unsupported_runtime",
          message: "Interactive terminals are unavailable in this runtime.",
          workingDir: "/repo/worktree",
        },
      },
    });
  });

  test("preserves workspace write failures in invoke error responses", async () => {
    const hostCommandRouter = createTestHostCommandRouter(() =>
      Effect.fail(
        new WorkspaceTextFileWriteError({
          message: "The file changed after it was loaded.",
          failure: {
            code: "stale_revision",
            message: "The file changed after it was loaded.",
            rootPath: "/repo",
            relativePath: "src/file.ts",
          },
        }),
      ),
    );

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/invoke/filesystem_write_text_file", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({
          rootPath: "/repo",
          relativePath: "src/file.ts",
          contents: "draft",
          revision: "sha256:old",
        }),
      }),
      { hostCommandRouter },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "The file changed after it was loaded.",
      message: "The file changed after it was loaded.",
      failure: {
        kind: "workspace_text_file_write",
        workspaceTextFileWriteFailure: {
          code: "stale_revision",
          message: "The file changed after it was loaded.",
          rootPath: "/repo",
          relativePath: "src/file.ts",
        },
      },
    });
  });

  test("preserves structured session history failures in invoke error responses", async () => {
    const hostCommandRouter = createTestHostCommandRouter(() =>
      Effect.fail(
        new CodexSessionHistoryError({
          message: "Codex thread/turns/list response data[0] must be an object",
          runtimeId: "runtime-1",
          threadId: "thread-1",
          failure: {
            code: "invalid_runtime_response",
            summary: "Codex returned invalid conversation history.",
            detail: "Codex thread/turns/list response data[0] must be an object",
            diagnosticId: "diagnostic-1",
            method: "thread/turns/list",
            pageCursor: null,
          },
        }),
      ),
    );

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/invoke/codex_app_server_request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({
          runtimeId: "runtime-1",
          method: "thread/turns/list",
          params: { threadId: "thread-1" },
        }),
      }),
      { hostCommandRouter },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Codex thread/turns/list response data[0] must be an object",
      message: "Codex thread/turns/list response data[0] must be an object",
      failure: {
        kind: "session_history",
        sessionHistoryFailure: {
          code: "invalid_runtime_response",
          summary: "Codex returned invalid conversation history.",
          detail: "Codex thread/turns/list response data[0] must be an object",
          diagnosticId: "diagnostic-1",
          method: "thread/turns/list",
          pageCursor: null,
        },
      },
    });
  });

  test("preserves structured task asset failures in invoke error responses", async () => {
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const hostCommandRouter = createTestHostCommandRouter(() =>
      Effect.fail(
        new TaskAssetError({
          operation: "update",
          code: "partial_state",
          taskId: "task-1",
          assetIds: [assetId],
          failedPhase: "compensate_update",
          durableState: "unknown",
          retryAllowed: false,
          message: "Refresh before continuing.",
        }),
      ),
    );

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/invoke/task_update", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({}),
      }),
      { hostCommandRouter },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      failure: {
        kind: "task_asset",
        taskAssetFailure: {
          code: "partial_state",
          taskId: "task-1",
          assetIds: [assetId],
          retryAllowed: false,
        },
      },
    });
  });

  test("flushes an initial SSE frame for the shared host event stream", async () => {
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/events", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      { eventBus: new BufferedHostEventBus({ report: () => {} }) },
    );

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }
    try {
      const chunk = await readImmediateStreamChunk(reader);
      expect(chunk.done).toBe(false);
      expect(new TextDecoder().decode(chunk.value)).toBe(": openducktor-ready\n\n");
    } finally {
      await reader.cancel();
    }
  });

  test("uses task leases instead of generic event replay and ignores Last-Event-ID", async () => {
    let sink: ((frame: TaskEventStreamFrame) => void) | null = null;
    const subscribeCalls: unknown[] = [];
    const acknowledged: unknown[] = [];
    const taskEventLeaseManager = createTaskEventLeaseManager({
      encodeFrame: (frame) =>
        new TextEncoder().encode(
          `id: ${frame.cursor.epoch}:${frame.cursor.sequence}\nevent: task-frame\ndata: ${JSON.stringify(frame)}\n\n`,
        ),
      reportDeliveryFailure: () => {},
      taskEventStream: {
        acknowledge: (input) => acknowledged.push(input),
        publish: () => {},
        subscribe: (input, nextSink) => {
          subscribeCalls.push(input);
          // SAFETY: This test controls the fixture and supplies `(frame: TaskEventStreamFrame) => void` used by this case.
          sink = nextSink as (frame: TaskEventStreamFrame) => void;
          return { subscriptionId: "host-subscription", unsubscribe: () => {} };
        },
      },
    });
    const create = await handleTestRequest(
      new Request("http://127.0.0.1/task-events/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-openducktor-app-token": APP_TOKEN },
        body: JSON.stringify({ cursor: null }),
      }),
      { taskEventLeaseManager },
    );
    expect(create.status).toBe(201);
    // SAFETY: This test controls the fixture and supplies `{ subscriptionId: string; streamToken: string }` used by this case.
    const created = (await create.json()) as { subscriptionId: string; streamToken: string };
    expect(subscribeCalls).toEqual([{ cursor: null }]);

    // SAFETY: This test controls the fixture and supplies `Request` used by this case.
    const stream = await handleTestRequest(
      {
        headers: new Headers([
          ["cookie", `openducktor_web_session=${APP_TOKEN}`],
          ["last-event-id", "999999"],
        ]),
        method: "GET",
        url: `http://127.0.0.1/task-events/subscriptions/${created.subscriptionId}/stream?token=${created.streamToken}`,
      } as Request,
      { taskEventLeaseManager },
    );
    expect(stream.status).toBe(200);
    const reader = stream.body?.getReader();
    if (!reader || !sink) throw new Error("Expected task event stream subscription.");
    const frame = {
      type: "snapshot_required" as const,
      cursor: { epoch: "fc49d1f9-708c-4198-b56b-f1437b2bbcea", sequence: 0 },
      reason: "buffer_gap" as const,
    };
    // SAFETY: This test controls the fixture and supplies `(nextFrame: typeof frame) => void` used by this case.
    (sink as (nextFrame: typeof frame) => void)(frame);
    const sse = new TextDecoder().decode((await reader.read()).value);
    expect(sse).toContain("event: task-frame");
    expect(sse).toContain(JSON.stringify(frame));
    await reader.cancel();

    // SAFETY: This test controls the fixture and supplies `Request` used by this case.
    const reconnect = await handleTestRequest(
      {
        headers: new Headers([["cookie", `openducktor_web_session=${APP_TOKEN}`]]),
        method: "GET",
        url: `http://127.0.0.1/task-events/subscriptions/${created.subscriptionId}/stream?token=${created.streamToken}`,
      } as Request,
      { taskEventLeaseManager },
    );
    expect(reconnect.status).toBe(200);
    const reconnectReader = reconnect.body?.getReader();
    if (!reconnectReader) throw new Error("Expected task event stream reconnection.");
    expect(new TextDecoder().decode((await reconnectReader.read()).value)).toContain(
      JSON.stringify(frame),
    );
    expect(subscribeCalls).toHaveLength(1);

    const acknowledgement = await handleTestRequest(
      new Request(`http://127.0.0.1/task-events/subscriptions/${created.subscriptionId}/ack`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
          "x-openducktor-task-stream-token": created.streamToken,
        },
        body: JSON.stringify({ cursor: frame.cursor }),
      }),
      { taskEventLeaseManager },
    );
    expect(acknowledgement.status).toBe(204);
    expect(acknowledged).toEqual([{ cursor: frame.cursor, subscriptionId: "host-subscription" }]);
    await reconnectReader.cancel();

    const lease = taskEventLeaseManager.get(created.subscriptionId);
    if (!lease) throw new Error("Expected task event stream lease.");
    taskEventLeaseManager.delete(lease);
    // SAFETY: This test controls the fixture and supplies `Request` used by this case.
    const expired = await handleTestRequest(
      {
        headers: new Headers([["cookie", `openducktor_web_session=${APP_TOKEN}`]]),
        method: "GET",
        url: `http://127.0.0.1/task-events/subscriptions/${created.subscriptionId}/stream?token=${created.streamToken}`,
      } as Request,
      { taskEventLeaseManager },
    );
    expect(expired.status).toBe(410);
    expect(subscribeCalls).toHaveLength(1);

    // SAFETY: This test controls the fixture and supplies `Request` used by this case.
    const tampered = await handleTestRequest(
      {
        headers: new Headers([["cookie", `openducktor_web_session=${APP_TOKEN}`]]),
        method: "GET",
        url: `http://127.0.0.1/task-events/subscriptions/${created.subscriptionId}/stream?token=tampered`,
      } as Request,
      { taskEventLeaseManager },
    );
    expect(tampered.status).toBe(403);
    expect(subscribeCalls).toHaveLength(1);
  });

  test("multiplexes non-task host event channels through the shared SSE endpoint", async () => {
    const eventBus = new BufferedHostEventBus({ report: () => {} });
    const events = [
      { channel: "openducktor://run-event", payload: { type: "run" } },
      {
        channel: "openducktor://dev-server-event",
        payload: {
          type: "snapshot",
          state: {
            repoPath: "/repo",
            taskId: "task-1",
            worktreePath: null,
            scripts: [],
            updatedAt: "2026-03-19T15:30:00.000Z",
          },
        },
      },
      {
        channel: "openducktor://agent-session-live-event",
        payload: {
          type: "snapshot",
          repoPath: "/repo",
          sessions: [],
        },
      },
    ] as const satisfies readonly HostEventEnvelope[];
    for (const event of events) {
      eventBus.publish(event);
    }

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/events", {
        method: "GET",
        headers: {
          "last-event-id": "0",
          "x-openducktor-app-token": APP_TOKEN,
        },
      }),
      { eventBus },
    );

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }
    try {
      expect(new TextDecoder().decode((await readImmediateStreamChunk(reader)).value)).toBe(
        ": openducktor-ready\n\n",
      );
      let replay = "";
      for (const _event of events) {
        replay += new TextDecoder().decode((await readImmediateStreamChunk(reader)).value);
      }
      for (const event of events) {
        expect(replay).toContain(JSON.stringify(event));
      }
    } finally {
      await reader.cancel();
    }
  });

  test("isolates buffered bus delivery failures after accepting and buffering the event", () => {
    const failure = new Error("first listener failed");
    const reported: unknown[] = [];
    const eventBus = new BufferedHostEventBus({
      report: ({ cause }) => reported.push(cause),
    });
    const received = mock(() => {});
    const unsubscribeReceived = eventBus.subscribe("openducktor://run-event", received);
    eventBus.subscribe("openducktor://run-event", () => {
      throw failure;
    });
    let unsubscribeDuringDelivery = () => {};
    eventBus.subscribe("openducktor://run-event", () => unsubscribeDuringDelivery());
    unsubscribeDuringDelivery = unsubscribeReceived;

    expect(() =>
      eventBus.publish({ channel: "openducktor://run-event", payload: { type: "run" } }),
    ).not.toThrow();
    expect(received).toHaveBeenCalledWith({
      channel: "openducktor://run-event",
      payload: { type: "run" },
    });
    expect(reported).toEqual([failure]);
    expect(eventBus.stream().replayAfter(0)).toHaveLength(1);
  });

  test("emits a stream warning when shared SSE replay cannot cover the reconnect gap", async () => {
    const eventBus = new BufferedHostEventBus({ report: () => {} });
    for (let index = 0; index < 258; index += 1) {
      eventBus.publish({
        channel: "openducktor://dev-server-event",
        payload: {
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-1",
          terminalChunk: {
            scriptId: "web",
            runIdentity: {
              runId: "run-1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
            },
            sequence: index,
            data: `line-${index}\r\n`,
            timestamp: "2026-03-19T15:30:00.000Z",
          },
        },
      });
    }

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/events", {
        method: "GET",
        headers: {
          "last-event-id": "1",
          "x-openducktor-app-token": APP_TOKEN,
        },
      }),
      { eventBus },
    );

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }
    try {
      const readyChunk = await readImmediateStreamChunk(reader);
      expect(readyChunk.done).toBe(false);
      expect(new TextDecoder().decode(readyChunk.value)).toBe(": openducktor-ready\n\n");

      const warningChunk = await readImmediateStreamChunk(reader);
      expect(warningChunk.done).toBe(false);
      expect(new TextDecoder().decode(warningChunk.value)).toBe(
        "event: stream-warning\n" +
          "data: Host event stream skipped 1 event; reconnect will replay buffered events.\n\n",
      );

      const replayChunk = await readImmediateStreamChunk(reader);
      expect(replayChunk.done).toBe(false);
      expect(new TextDecoder().decode(replayChunk.value)).toContain('"data":"line-2\\r\\n"');
    } finally {
      await reader.cancel();
    }
  });

  test("rejects malformed invoke command URI components as typed host request errors", async () => {
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/invoke/%E0%A4%A", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid command URI component: %E0%A4%A",
      message: "Invalid command URI component: %E0%A4%A",
    });
  });

  test("resolves host backend exit after stop server failures", async () => {
    const resolvedExitCodes: number[] = [];

    await expect(
      stopTypescriptHostBackendServices({
        disposeHost: () => Effect.void,
        logger: testLogger,
        resolveExited: (exitCode) => {
          resolvedExitCodes.push(exitCode);
        },
        stopServer: () => {
          throw new Error("stop server failed");
        },
      }),
    ).rejects.toMatchObject({ _tag: "WebOperationError" });
    expect(resolvedExitCodes).toEqual([1]);
  });

  test("resolves host backend exit after asynchronous stop server failures", async () => {
    const resolvedExitCodes: number[] = [];

    await expect(
      stopTypescriptHostBackendServices({
        disposeHost: () => Effect.void,
        logger: testLogger,
        resolveExited: (exitCode) => {
          resolvedExitCodes.push(exitCode);
        },
        stopServer: async () => {
          throw new Error("async stop server failed");
        },
      }),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.host.stop-server",
    });
    expect(resolvedExitCodes).toEqual([1]);
  });

  test("stops the backend and resolves exit when failure logging rejects", async () => {
    const persistenceError = new Error(
      "openducktor.logs.append failed for /tmp/openducktor-web.log",
    );
    const resolvedExitCodes: number[] = [];
    let stopCalls = 0;

    await expect(
      stopTypescriptHostBackendServices({
        disposeHost: () => Effect.fail(new Error("host disposal failed")),
        logger: {
          error: () => Effect.fail(persistenceError),
          info: () => Effect.void,
          success: () => Effect.void,
        },
        resolveExited: (exitCode) => {
          resolvedExitCodes.push(exitCode);
        },
        stopServer: () => {
          stopCalls += 1;
        },
      }),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.host.shutdown",
      details: {
        failures: [
          expect.objectContaining({ message: "host disposal failed" }),
          expect.objectContaining({
            _tag: "WebResourceError",
            cause: persistenceError,
            resource: "persistent-log",
          }),
        ],
      },
    });

    expect(stopCalls).toBe(1);
    expect(resolvedExitCodes).toEqual([1]);
  });

  test("rejects missing or invalid backend auth through typed route errors", async () => {
    const sessionMissing = await handleTestRequest(
      new Request("http://127.0.0.1/session", { method: "POST" }),
    );
    expect(sessionMissing.status).toBe(401);
    expect(await sessionMissing.json()).toEqual({
      error: "Missing OpenDucktor web host app token.",
      message: "Missing OpenDucktor web host app token.",
    });

    const sessionInvalid = await handleTestRequest(
      new Request("http://127.0.0.1/session", {
        method: "POST",
        headers: { "x-openducktor-app-token": "wrong" },
      }),
    );
    expect(sessionInvalid.status).toBe(403);
    expect(await sessionInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host app token.",
      message: "Invalid OpenDucktor web host app token.",
    });

    let stopCalls = 0;
    const stop = async () => {
      stopCalls += 1;
    };
    const shutdownMissing = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", { method: "POST" }),
      { stop },
    );
    expect(shutdownMissing.status).toBe(401);
    expect(await shutdownMissing.json()).toEqual({
      error: "Missing OpenDucktor web host control token.",
      message: "Missing OpenDucktor web host control token.",
    });
    expect(stopCalls).toBe(0);

    const shutdownInvalid = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", {
        method: "POST",
        headers: { "x-openducktor-control-token": "wrong" },
      }),
      { stop },
    );
    expect(shutdownInvalid.status).toBe(403);
    expect(await shutdownInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host control token.",
      message: "Invalid OpenDucktor web host control token.",
    });
    expect(stopCalls).toBe(0);

    const previewUrl = "http://127.0.0.1/local-attachment-preview?path=/tmp/file";
    const previewMissing = await handleTestRequest(new Request(previewUrl));
    expect(previewMissing.status).toBe(401);
    expect(await previewMissing.json()).toEqual({
      error: "Missing OpenDucktor web host app token.",
      message: "Missing OpenDucktor web host app token.",
    });

    // SAFETY: This test controls the fixture and supplies `Request` used by this case.
    const previewInvalid = await handleTestRequest({
      headers: new Headers([["cookie", "openducktor_web_session=wrong"]]),
      method: "GET",
      url: previewUrl,
    } as Request);
    expect(previewInvalid.status).toBe(403);
    expect(await previewInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host app token.",
      message: "Invalid OpenDucktor web host app token.",
    });
  });

  test("serves task assets only through the authenticated exact-context route", async () => {
    const context = {
      workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
      taskId: "task-1",
      scope: "description",
      assetId: "550e8400-e29b-41d4-a716-446655440000",
    };
    let readInput: unknown;
    const taskAssetReadService: TaskAssetReadService = {
      read: (input) => {
        readInput = input;
        return Effect.succeed({
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: "image/png",
          headers: {
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'inline; filename="diagram.png"',
            "Content-Type": "image/png",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
      readBatch: () => Effect.succeed({ kind: "missing", assetIds: [] }),
    };
    const url = `http://127.0.0.1/task-assets/${context.workspaceId}/${context.taskId}/${context.scope}/${context.assetId}`;

    const unauthorized = await handleTestRequest(new Request(url), { taskAssetReadService });
    expect(unauthorized.status).toBe(401);
    expect(readInput).toBeUndefined();

    // SAFETY: This test controls the fixture and supplies `Request` used by this case.
    const response = await handleTestRequest(
      {
        headers: new Headers([["cookie", `openducktor_web_session=${APP_TOKEN}`]]),
        method: "GET",
        url,
      } as Request,
      { taskAssetReadService },
    );

    expect(response.status).toBe(200);
    expect(readInput).toEqual(context);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("returns 404 when an authenticated task asset relation is missing", async () => {
    const url =
      "http://127.0.0.1/task-assets/9f66372b-e956-47f4-af2f-77e0df2ad4e1/task-1/description/550e8400-e29b-41d4-a716-446655440000";
    // SAFETY: This test controls the fixture and supplies `Request` used by this case.
    const response = await handleTestRequest({
      headers: new Headers([["cookie", `openducktor_web_session=${APP_TOKEN}`]]),
      method: "GET",
      url,
    } as Request);

    expect(response.status).toBe(404);
  });

  test("marks shutdown as started before deferred host teardown runs", async () => {
    let shutdownStarted = false;
    let stopCalls = 0;

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", {
        method: "POST",
        headers: { "x-openducktor-control-token": CONTROL_TOKEN },
      }),
      {
        beginShutdown: () => {
          shutdownStarted = true;
        },
        stop: async () => {
          stopCalls += 1;
        },
      },
    );

    expect(response.status).toBe(202);
    expect(shutdownStarted).toBe(true);
    expect(stopCalls).toBe(0);
  });

  test("rejects invokes after the shutdown gate while host teardown remains pending", async () => {
    const disposeStarted = createDeferred();
    const disposeReleased = createDeferred();
    let invokeCalls = 0;
    const teardown = stopTypescriptHostBackendServices({
      disposeHost: () =>
        Effect.promise(async () => {
          disposeStarted.resolve();
          await disposeReleased.promise;
        }),
      logger: testLogger,
      resolveExited: () => {},
      stopServer: () => {},
    });

    await disposeStarted.promise;
    try {
      const response = await handleTestRequest(
        new Request("http://127.0.0.1/invoke/runtime_ensure", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-openducktor-app-token": APP_TOKEN,
          },
          body: JSON.stringify({}),
        }),
        {
          hostCommandRouter: createTestHostCommandRouter(() => {
            invokeCalls += 1;
            return Effect.succeed(null);
          }),
          shutdownStarted: true,
        },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Browser backend is shutting down and is no longer accepting new work.",
        message: "Browser backend is shutting down and is no longer accepting new work.",
      });
      expect(invokeCalls).toBe(0);
    } finally {
      disposeReleased.resolve();
      await teardown;
    }
  });

  test("rejects new SSE streams after the shutdown gate without opening a subscription", async () => {
    const eventBus = new BufferedHostEventBus({ report: () => {} });
    const stream = eventBus.stream();
    const originalStream = eventBus.stream.bind(eventBus);
    const originalSubscribe = stream.subscribe.bind(stream);
    let streamCalls = 0;
    let subscribeCalls = 0;
    eventBus.stream = () => {
      streamCalls += 1;
      return originalStream();
    };
    stream.subscribe = (listener) => {
      subscribeCalls += 1;
      return originalSubscribe(listener);
    };

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/events", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      { eventBus, shutdownStarted: true },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Browser backend is shutting down and is no longer accepting new work.",
      message: "Browser backend is shutting down and is no longer accepting new work.",
    });
    expect(streamCalls).toBe(0);
    expect(subscribeCalls).toBe(0);
  });

  test("keeps active SSE streams open until forced server shutdown", async () => {
    const eventBus = new BufferedHostEventBus({ report: () => {} });
    const disposeStarted = createDeferred();
    const disposeReleased = createDeferred();
    let shutdownStarted = false;
    let server!: ReturnType<typeof Bun.serve>;
    let stopPromise: Promise<void> | null = null;
    const stop = (): Promise<void> => {
      if (stopPromise) {
        return stopPromise;
      }
      shutdownStarted = true;
      stopPromise = stopTypescriptHostBackendServices({
        disposeHost: () =>
          Effect.promise(async () => {
            disposeStarted.resolve();
            await disposeReleased.promise;
          }),
        logger: testLogger,
        resolveExited: () => {},
        stopServer: () => server.stop(true),
      });
      return stopPromise;
    };
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, requestServer) =>
        Effect.runPromise(
          handleTypescriptHostBackendRequest({
            allowedOrigins: new Set(),
            appSessionCookieName: APP_SESSION_COOKIE_NAME,
            appToken: APP_TOKEN,
            controlToken: CONTROL_TOKEN,
            eventBus,
            hostCommandRouter: createTestHostCommandRouter(),
            taskAssetReadService: missingTaskAssetReadService,
            localAttachments: createLocalAttachmentAdapter(),
            logger: testLogger,
            request,
            requestTimeouts: requestServer,
            shutdownStarted,
            beginShutdown: () => {
              shutdownStarted = true;
            },
            stop,
          }),
        ),
    });

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await Bun.fetch(`http://127.0.0.1:${server.port}/events`, {
        headers: { "x-openducktor-app-token": APP_TOKEN },
      });
      expect(response.status).toBe(200);
      reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Expected SSE response body.");
      }
      expect(new TextDecoder().decode((await readImmediateStreamChunk(reader)).value)).toBe(
        ": openducktor-ready\n\n",
      );

      const shutdown = stop();
      await disposeStarted.promise;
      eventBus.publish({ channel: "openducktor://run-event", payload: { type: "run" } });
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"run"');

      disposeReleased.resolve();
      await shutdown;
      const terminalRead = await reader.read().then(
        (result) => ({ result }),
        (cause: unknown) => ({ error: cause }),
      );
      if ("error" in terminalRead) {
        expect(terminalRead.error).toBeInstanceOf(Error);
      } else {
        expect(terminalRead.result.done).toBe(true);
      }
    } finally {
      disposeReleased.resolve();
      if (stopPromise) {
        await stopPromise;
      } else {
        server.stop(true);
      }
      try {
        await reader?.cancel();
      } catch {
        // Bun rejects an SSE reader after server.stop(true) force-closes its socket.
      }
    }
  });

  test("keeps the backend server alive until host disposal finishes", async () => {
    const calls: string[] = [];
    let releaseDispose: () => void = () => {};
    const disposeReleased = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    let disposeStarted: () => void = () => {};
    const disposeStartedPromise = new Promise<void>((resolve) => {
      disposeStarted = resolve;
    });

    const stopPromise = stopTypescriptHostBackendServices({
      disposeHost: () =>
        Effect.promise(async () => {
          calls.push("dispose-started");
          disposeStarted();
          await disposeReleased;
          calls.push("dispose-finished");
        }),
      resolveExited: (exitCode) => {
        calls.push(`exited-${exitCode}`);
      },
      logger: testLogger,
      stopServer: () => {
        calls.push("server-stopped");
      },
    });

    await disposeStartedPromise;
    expect(calls).toEqual(["dispose-started"]);

    releaseDispose();
    await stopPromise;
    expect(calls).toEqual(["dispose-started", "dispose-finished", "server-stopped", "exited-0"]);
  });
});
