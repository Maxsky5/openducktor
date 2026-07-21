import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
  TERMINAL_PROTOCOL_VERSION,
} from "@openducktor/contracts";
import {
  createLocalAttachmentAdapter,
  createSourceRuntimeDistribution,
  type EffectHostCommandRouter,
  TerminalServiceError,
} from "@openducktor/host";
import { Deferred, Effect, TestClock, TestContext } from "effect";
import WebSocket from "ws";
import { createWebLogger, type WebLogger } from "./logger";
import {
  BufferedHostEventBus,
  stopTypescriptHostBackendServices,
  validateWebFrontendOrigin,
} from "./typescript-host-backend-support";

const nativeResponse = await Bun.fetch("data:,");
(globalThis as typeof globalThis & { Response: typeof Response }).Response =
  nativeResponse.constructor as typeof Response;

const {
  handleTypescriptHostBackendRequest,
  startTypescriptHostBackend,
  startTypescriptHostBackendEffect,
} = await import("./typescript-host-backend");

const APP_TOKEN = "app-token";
const CONTROL_TOKEN = "control-token";
const FRONTEND_ORIGIN = "http://127.0.0.1:1420";
const SOURCE_RUNTIME_DISTRIBUTION = createSourceRuntimeDistribution(
  path.resolve(import.meta.dir, "../../.."),
);
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
  args?: Record<string, unknown>,
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

const createTestHostCommandRouter = (
  invoke: TestHostCommandInvoke = () => Effect.succeed(null),
): EffectHostCommandRouter => ({
  dispose: () => Effect.void,
  initialize: () => Effect.void,
  invoke: (command, args) => invoke(command, args) as ReturnType<EffectHostCommandRouter["invoke"]>,
});

type TestRequestOptions = Partial<{
  appToken: string;
  controlToken: string;
  eventBus: BufferedHostEventBus;
  hostCommandRouter: EffectHostCommandRouter;
  beginShutdown: () => void;
  shutdownStarted: boolean;
  stop: () => Promise<void>;
}>;

const handleTestRequest = (
  request: Request,
  options: TestRequestOptions = {},
): Promise<Response> => {
  const hostCommandRouter = options.hostCommandRouter ?? createTestHostCommandRouter();
  return Effect.runPromise(
    handleTypescriptHostBackendRequest({
      allowedOrigins: new Set(),
      appToken: options.appToken ?? APP_TOKEN,
      controlToken: options.controlToken ?? CONTROL_TOKEN,
      eventBus: options.eventBus ?? new BufferedHostEventBus(),
      hostCommandRouter,
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
  test("serves health, session, invoke, and shutdown through the browser HTTP contract", async () => {
    const previousConfigDir = process.env.OPENDUCKTOR_CONFIG_DIR;
    const tempConfigDir = await mkdtemp(path.join(tmpdir(), "openducktor-web-host-"));
    let backend: Awaited<ReturnType<typeof startTypescriptHostBackend>> | undefined;
    const consoleLines: string[] = [];
    const productionDiscoveryPath = path.join(tempConfigDir, "runtime", "mcp-bridge.json");
    const developmentDiscoveryPath = path.join(tempConfigDir, "runtime", "mcp-bridge-dev.json");
    const productionDiscovery = '{"hostUrl":"http://127.0.0.1:1","hostToken":"prod","pid":1}\n';

    try {
      process.env.OPENDUCKTOR_CONFIG_DIR = tempConfigDir;
      await mkdir(path.dirname(productionDiscoveryPath), { recursive: true });
      await writeFile(productionDiscoveryPath, productionDiscovery, "utf8");
      const logger = await Effect.runPromise(
        createWebLogger({
          console: {
            error: (message) => consoleLines.push(message),
            log: (message) => consoleLines.push(message),
          },
          environment: { OPENDUCKTOR_CONFIG_DIR: tempConfigDir, NO_COLOR: "1" },
          now: () => new Date(2026, 4, 13, 23, 45, 12, 345),
        }),
      );
      backend = await startTypescriptHostBackend({
        port: 0,
        frontendOrigin: FRONTEND_ORIGIN,
        controlToken: CONTROL_TOKEN,
        appToken: APP_TOKEN,
        logger,
        mcpBridgeDiscoveryMode: "development",
        onBackgroundFailure: () => {},
        runtimeDistribution: SOURCE_RUNTIME_DISTRIBUTION,
      });
      const backendUrl = `http://127.0.0.1:${backend.port}`;
      await expect(readFile(productionDiscoveryPath, "utf8")).resolves.toBe(productionDiscovery);
      expect(JSON.parse(await readFile(developmentDiscoveryPath, "utf8"))).toEqual({
        hostToken: expect.any(String),
        hostUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
        pid: process.pid,
      });

      const health = await Bun.fetch(`${backendUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const session = await Bun.fetch(`${backendUrl}/session`, {
        method: "POST",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      });
      expect(session.status).toBe(200);
      expect(session.headers.get("set-cookie")).toContain("openducktor_web_session=app-token");

      if (process.platform !== "win32") {
        const terminalIds: string[] = [];
        for (let index = 0; index < 2; index += 1) {
          const createTerminal = await Bun.fetch(`${backendUrl}/invoke/terminal_create`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-openducktor-app-token": APP_TOKEN,
            },
            body: JSON.stringify({ workingDir: tempConfigDir, context: {} }),
          });
          expect(createTerminal.status).toBe(200);
          const created = (await createTerminal.json()) as { ref: { terminalId: string } };
          terminalIds.push(created.ref.terminalId);
        }
        const socket = new WebSocket(
          `${backendUrl.replace("http://", "ws://")}/terminal`,
          [TERMINAL_PROTOCOL_SUBPROTOCOL],
          {
            headers: {
              cookie: `openducktor_web_session=${APP_TOKEN}`,
              origin: FRONTEND_ORIGIN,
            },
          },
        );
        socket.binaryType = "arraybuffer";
        await new Promise<void>((resolve, reject) => {
          let opened = false;
          socket.once("open", () => {
            opened = true;
            resolve();
          });
          socket.on("error", (cause) => {
            if (!opened) reject(cause);
          });
        });
        expect(socket.protocol).toBe(TERMINAL_PROTOCOL_SUBPROTOCOL);
        const snapshots = new Promise<string[]>((resolve, reject) => {
          const attached = new Set<string>();
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for multiplexed terminal snapshots.")),
            1_000,
          );
          socket.on("message", (data) => {
            const bytes =
              data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as Buffer);
            const decoded = decodeTerminalProtocolFrame(bytes);
            if (decoded.message.type !== "snapshot") return;
            attached.add(decoded.message.terminalId);
            if (attached.size === terminalIds.length) {
              clearTimeout(timeout);
              resolve([...attached]);
            }
          });
        });
        for (const terminalId of terminalIds) {
          socket.send(
            encodeTerminalProtocolFrame({
              message: {
                version: TERMINAL_PROTOCOL_VERSION,
                type: "attach",
                terminalId,
                lastConsumedSequence: null,
              },
              payload: new Uint8Array(),
            }),
          );
        }
        expect((await snapshots).sort()).toEqual([...terminalIds].sort());
        const unknownTerminalFailure = new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for unknown-terminal rejection.")),
            1_000,
          );
          socket.on("message", (data) => {
            const bytes =
              data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as Buffer);
            const decoded = decodeTerminalProtocolFrame(bytes);
            if (
              decoded.message.type === "protocol_error" &&
              decoded.message.failure.code === "terminal_not_found"
            ) {
              clearTimeout(timeout);
              resolve(decoded.message.terminalId ?? "");
            }
          });
        });
        socket.send(
          encodeTerminalProtocolFrame({
            message: {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "input",
              terminalId: "missing-terminal",
            },
            payload: new Uint8Array([1]),
          }),
        );
        expect(await unknownTerminalFailure).toBe("missing-terminal");
        const oversizedClose = new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for oversized-frame rejection.")),
            1_000,
          );
          socket.once("close", (code) => {
            clearTimeout(timeout);
            resolve(code);
          });
        });
        socket.send(new Uint8Array(1024 * 1024 + 1));
        expect([1006, 1009]).toContain(await oversizedClose);
      }

      const rejectedTerminalOrigin = await Bun.fetch(`${backendUrl}/terminal`, {
        headers: { origin: "http://evil.example" },
      });
      expect(rejectedTerminalOrigin.status).toBe(403);

      const rejectedTerminalSession = await Bun.fetch(`${backendUrl}/terminal`, {
        headers: { origin: FRONTEND_ORIGIN },
      });
      expect(rejectedTerminalSession.status).toBe(401);

      const rejectedTerminalProtocol = await Bun.fetch(`${backendUrl}/terminal`, {
        headers: {
          cookie: `openducktor_web_session=${APP_TOKEN}`,
          origin: FRONTEND_ORIGIN,
          "sec-websocket-protocol": "openducktor-terminal.v0",
        },
      });
      expect(rejectedTerminalProtocol.status).toBe(426);

      const invoke = await Bun.fetch(`${backendUrl}/invoke/runtime_definitions_list`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({}),
      });
      expect(invoke.status).toBe(200);
      expect(await invoke.json()).toMatchObject([{ kind: "opencode" }, { kind: "codex" }]);

      const theme = await Bun.fetch(`${backendUrl}/invoke/set_theme`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({ theme: "dark" }),
      });
      expect(theme.status).toBe(200);
      expect(await theme.json()).toBeNull();

      const shutdown = await Bun.fetch(`${backendUrl}/shutdown`, {
        method: "POST",
        headers: { "x-openducktor-control-token": CONTROL_TOKEN },
      });
      expect(shutdown.status).toBe(202);
      await expect(backend.exited).resolves.toBe(0);
      await expect(readFile(productionDiscoveryPath, "utf8")).resolves.toBe(productionDiscovery);
      await expect(readFile(developmentDiscoveryPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      const persisted = await readFile(
        path.join(tempConfigDir, "logs", "openducktor-web-2026-05-13.log"),
        "utf8",
      );
      expect(persisted).toContain("INFO Shutting down OpenDucktor host services\n");
      expect(persisted).toContain("INFO OpenDucktor host services stopped\n");
      expect(
        consoleLines.some((line) => line.includes("Shutting down OpenDucktor host services")),
      ).toBe(true);
    } finally {
      if (backend) {
        await backend.stop();
      }
      if (previousConfigDir === undefined) {
        delete process.env.OPENDUCKTOR_CONFIG_DIR;
      } else {
        process.env.OPENDUCKTOR_CONFIG_DIR = previousConfigDir;
      }
      await rm(tempConfigDir, { force: true, recursive: true });
    }
  }, 10_000);

  test("owns a scheduled task-sync disk-write failure through the browser host lifecycle", async () => {
    const previousConfigDir = process.env.OPENDUCKTOR_CONFIG_DIR;
    const tempConfigDir = await mkdtemp(path.join(tmpdir(), "openducktor-web-task-sync-"));
    const recordedAt = new Date(2026, 4, 13, 23, 45, 12, 345);
    const configPath = path.join(tempConfigDir, "config.json");
    const logFilePath = path.join(tempConfigDir, "logs", "openducktor-web-2026-05-13.log");
    let backend: Awaited<ReturnType<typeof startTypescriptHostBackend>> | undefined;
    process.env.OPENDUCKTOR_CONFIG_DIR = tempConfigDir;

    try {
      const logger = await Effect.runPromise(
        createWebLogger({
          console: { error: () => {}, log: () => {} },
          environment: { OPENDUCKTOR_CONFIG_DIR: tempConfigDir, NO_COLOR: "1" },
          now: () => recordedAt,
        }),
      );
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const failureReported = yield* Deferred.make<unknown>();
          const startedBackend = yield* startTypescriptHostBackendEffect({
            port: 0,
            frontendOrigin: FRONTEND_ORIGIN,
            controlToken: CONTROL_TOKEN,
            appToken: APP_TOKEN,
            logger,
            mcpBridgeDiscoveryMode: "development",
            onBackgroundFailure: (failure) => {
              Effect.runSync(Deferred.succeed(failureReported, failure));
            },
            runtimeDistribution: SOURCE_RUNTIME_DISTRIBUTION,
          });
          backend = startedBackend;
          const exitedFailure = startedBackend.exited.then(
            () => new Error("expected browser host background failure"),
            (failure: unknown) => failure,
          );

          yield* Effect.promise(() => mkdir(configPath));
          yield* Effect.promise(() => mkdir(logFilePath));
          yield* TestClock.adjust("5 minutes");
          const failure = yield* Deferred.await(failureReported);
          const rejectedExit = yield* Effect.promise(() => exitedFailure);
          yield* Effect.promise(() => rm(configPath, { recursive: true }));
          yield* Effect.promise(() => rm(logFilePath, { recursive: true }));
          const stopFailure = yield* Effect.promise(() =>
            startedBackend.stop().then(
              () => null,
              (cause: unknown) => cause,
            ),
          );
          return { failure, rejectedExit, stopFailure };
        }).pipe(Effect.provide(TestContext.TestContext)),
      );

      expect(result.failure).toMatchObject({
        _tag: "HostOperationError",
        operation: "task-sync.log-iteration-failure",
        cause: {
          _tag: "OpenDucktorLogPersistenceError",
          operation: "openducktor.logs.append",
          path: logFilePath,
        },
      });
      expect(result.rejectedExit).toBe(result.failure);
      expect(result.stopFailure).toMatchObject({
        _tag: "WebOperationError",
        operation: "web.host.dispose",
        cause: expect.objectContaining({
          _tag: "HostOperationError",
          operation: "host.shutdown",
        }),
      });
    } finally {
      await backend?.stop().catch(() => {});
      if (previousConfigDir === undefined) {
        delete process.env.OPENDUCKTOR_CONFIG_DIR;
      } else {
        process.env.OPENDUCKTOR_CONFIG_DIR = previousConfigDir;
      }
      await rm(tempConfigDir, { force: true, recursive: true });
    }
  }, 5_000);

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

  test("flushes an initial SSE frame for the shared host event stream", async () => {
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/events", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      { eventBus: new BufferedHostEventBus() },
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

  test("multiplexes every host event channel through the shared SSE endpoint", async () => {
    const eventBus = new BufferedHostEventBus();
    const events = [
      ["openducktor://run-event", { type: "run" }],
      ["openducktor://dev-server-event", { type: "dev-server" }],
      ["openducktor://task-event", { type: "task" }],
      [
        "openducktor://agent-session-live-event",
        {
          type: "snapshot",
          repoPath: "/repo",
          sessions: [],
        },
      ],
    ] as const;
    for (const [channel, payload] of events) {
      eventBus.publish(channel, payload);
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
      for (const [channel, payload] of events) {
        expect(replay).toContain(JSON.stringify({ channel, payload }));
      }
    } finally {
      await reader.cancel();
    }
  });

  test("emits a stream warning when shared SSE replay cannot cover the reconnect gap", async () => {
    const eventBus = new BufferedHostEventBus();
    for (let index = 0; index < 258; index += 1) {
      eventBus.publish("openducktor://dev-server-event", {
        type: "terminal_chunk",
        repoPath: "/repo",
        taskId: "task-1",
        terminalChunk: {
          scriptId: "web",
          sequence: index,
          data: `line-${index}\r\n`,
          timestamp: "2026-03-19T15:30:00.000Z",
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
    const eventBus = new BufferedHostEventBus();
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
    const eventBus = new BufferedHostEventBus();
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
            appToken: APP_TOKEN,
            controlToken: CONTROL_TOKEN,
            eventBus,
            hostCommandRouter: createTestHostCommandRouter(),
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
      eventBus.publish("openducktor://run-event", { type: "run" });
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"run"');

      disposeReleased.resolve();
      await shutdown;
      const terminalRead = await reader.read().then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
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
