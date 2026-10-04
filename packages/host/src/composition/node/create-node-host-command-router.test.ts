import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type HostEventEnvelope,
  hostRuntimeSnapshotSchema,
  mcpBridgeDiscoveryFileSchema,
} from "@openducktor/contracts";
import { Cause, Effect } from "effect";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { createSourceRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import { HostOperationError } from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { RuntimeStartInput, RuntimeStarterPort } from "../../ports/runtime-registry-port";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import type { TerminalPtyPort } from "../../ports/terminal-pty-port";
import type { HostLifecycleLogger } from "../host-lifecycle";
import { createNodeEffectHostCommandRouter } from "./create-node-effect-host-command-router";
import { createNodeHostCommandRouter } from "./create-node-host-command-router-promise";
import type {
  CreateNodeHostCommandRouterInput,
  EffectNodeHostCommandRouter,
} from "./node-host-command-router-types";
import { createLiveSessionFaultLogger } from "./node-host-lifecycle-logger";

const createRuntimeDistribution = () =>
  createSourceRuntimeDistribution(path.resolve(import.meta.dir, "../../../../.."));

type FakeRuntimeStarter = RuntimeStarterPort & {
  starts: RuntimeStartInput[];
  stops: string[];
};

/** Starts an in-memory runtime of each requested kind. */
const createRuntimeStarter = (
  stop: (runtimeId: string) => Effect.Effect<void, HostOperationError> = () => Effect.void,
): FakeRuntimeStarter => {
  const starts: RuntimeStartInput[] = [];
  const stops: string[] = [];
  return {
    starts,
    stops,
    startRuntime: (input) =>
      Effect.sync(() => {
        starts.push(input);
        const runtimeId = `${input.runtimeKind}-${starts.length}`;
        return {
          runtime: {
            kind: input.runtimeKind,
            runtimeId,
            runtimeRoute: { type: "host_service" as const, identity: runtimeId },
            startedAt: "2026-10-03T10:00:00.000Z",
            descriptor: input.descriptor,
          },
          configuredExecutablePath: input.runtimeKind,
          effectiveExecutablePath: `/bin/${input.runtimeKind}`,
          stop: () =>
            Effect.suspend(() => {
              stops.push(runtimeId);
              return stop(runtimeId);
            }),
        };
      }),
  };
};

const unusedRuntimeStarter: RuntimeStarterPort = {
  startRuntime: () => Effect.die("No runtime is enabled in this composition test."),
};

const runtimeHealth: RuntimeHealthPort = {
  getRuntimeHealth: () =>
    Effect.fail(new HostOperationError({ operation: "test.health", message: "not probed" })),
};

const createMcpHostBridge = (): McpHostBridgeServer =>
  ({
    ensureConnection: () =>
      Effect.succeed({
        workspaceId: "workspace-1",
        hostUrl: "http://127.0.0.1:5000",
        hostToken: "test-token",
      }),
    ensureExternalDiscoveryReady: () =>
      Effect.succeed({
        workspaceId: "workspace-1",
        hostUrl: "http://127.0.0.1:5000",
        hostToken: "test-token",
      }),
    status: () => ({
      state: "ready",
      hostUrl: "http://127.0.0.1:5000",
      failure: null,
      updatedAt: "2026-10-03T10:00:00.000Z",
      revision: 1,
    }),
    close: () => Effect.succeed({ baseUrl: null, closed: false }),
  }) satisfies McpHostBridgeServer;

const createEventBus = (): HostEventBusPort => ({
  publish() {},
  subscribe() {
    return () => {};
  },
});

const terminalPty: TerminalPtyPort = {
  start: () => Effect.die("Terminal PTY is not expected in this composition test."),
};

const createLogger = () => {
  const infos: string[] = [];
  const errors: string[] = [];
  const logger: HostLifecycleLogger = {
    error: (message) => Effect.sync(() => errors.push(String(message))),
    info: (message) => Effect.sync(() => infos.push(String(message))),
  };
  return { errors, infos, logger };
};

const createFailingRouterInput = (): CreateNodeHostCommandRouterInput => ({
  configDirScope: "test",
  mcpBridgeDiscoveryMode: "production",
  onBackgroundFailure: () => Effect.void,
  runtimeDistribution: {
    ...createRuntimeDistribution(),
    get mode(): "source" {
      throw new Error("Default port setup failed");
    },
  },
  taskEventPublicationReporter: { report: () => Effect.void },
  terminalPty,
});

const createAssemblyFailingRouterInput = (): CreateNodeHostCommandRouterInput => ({
  configDirScope: "test",
  get lifecycleLogger(): HostLifecycleLogger {
    throw new Error("Router assembly failed");
  },
  mcpBridgeDiscoveryMode: "production",
  onBackgroundFailure: () => Effect.void,
  runtimeDistribution: createRuntimeDistribution(),
  runtimeStarter: unusedRuntimeStarter,
  taskEventPublicationReporter: { report: () => Effect.void },
  taskStore: createTaskStoreTestDouble({}),
  terminalPty,
});

const createRouter = (input: {
  eventBus?: HostEventBusPort;
  logger: HostLifecycleLogger;
  onBackgroundFailure?: CreateNodeHostCommandRouterInput["onBackgroundFailure"];
  /** Enables OpenCode in saved settings and starts it with this starter. */
  runtimeStarter?: RuntimeStarterPort;
  mcpHostBridge?: McpHostBridgeServer;
}) => {
  const routerInput: Parameters<typeof createNodeEffectHostCommandRouter>[0] = {
    configDirScope: "test",
    lifecycleLogger: input.logger,
    mcpBridgeDiscoveryMode: "production",
    mcpHostBridge: input.mcpHostBridge ?? createMcpHostBridge(),
    onBackgroundFailure: input.onBackgroundFailure ?? (() => Effect.void),
    processEnv: { ...process.env },
    taskEventPublicationReporter: { report: () => Effect.void },
    runtimeDistribution: createRuntimeDistribution(),
    runtimeHealth,
    runtimeStarter: input.runtimeStarter ?? unusedRuntimeStarter,
    taskStore: createTaskStoreTestDouble({}),
    terminalPty,
  };
  if (input.runtimeStarter) {
    routerInput.settingsConfig = createFixedRuntimeSettingsConfig("opencode", "opencode");
  }
  if (input.eventBus) {
    routerInput.eventBus = input.eventBus;
  }
  return Effect.runPromise(createNodeEffectHostCommandRouter(routerInput));
};

describe("createNodeEffectHostCommandRouter", () => {
  test("returns synchronous setup faults through the Effect channel", async () => {
    const result = await Effect.runPromise(
      createNodeEffectHostCommandRouter(createFailingRouterInput()).pipe(Effect.either),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toEqual(
        expect.objectContaining({
          _tag: "HostOperationError",
          operation: "host.create-router",
          message: "Default port setup failed",
        }),
      );
    }
  });

  test("returns config directory validation faults through the Effect channel", async () => {
    const result = await Effect.runPromise(
      createNodeEffectHostCommandRouter({
        configDirScope: "test",
        mcpBridgeDiscoveryMode: "production",
        onBackgroundFailure: () => Effect.void,
        processEnv: { OPENDUCKTOR_CONFIG_DIR: "" },
        runtimeDistribution: createRuntimeDistribution(),
        taskEventPublicationReporter: { report: () => Effect.void },
        terminalPty,
      }).pipe(Effect.either),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toEqual(
        expect.objectContaining({
          _tag: "HostOperationError",
          operation: "host.create-router",
          message: "OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path",
        }),
      );
    }
  });

  test("rejects the Promise boundary for synchronous setup faults", async () => {
    const router = createNodeHostCommandRouter(createFailingRouterInput());

    await expect(router).rejects.toThrow("Default port setup failed");
  });

  test("returns synchronous assembly faults through the Effect channel", async () => {
    const result = await Effect.runPromise(
      createNodeEffectHostCommandRouter(createAssemblyFailingRouterInput()).pipe(Effect.either),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toEqual(
        expect.objectContaining({
          _tag: "HostOperationError",
          operation: "host.create-router",
          message: "Router assembly failed",
        }),
      );
    }
  });

  test("publishes development discovery from composition mode despite ambient channel", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-node-host-discovery-"));
    const { logger } = createLogger();
    const router = Effect.runSync(
      createNodeEffectHostCommandRouter({
        configDirScope: "test",
        lifecycleLogger: logger,
        mcpBridgeDiscoveryMode: "development",
        onBackgroundFailure: () => Effect.void,
        processEnv: {
          OPENDUCKTOR_CHANNEL: "production",
          OPENDUCKTOR_CONFIG_DIR: configDir,
          OPENDUCKTOR_DEV_INSTANCE: "browser-0123456789ab",
        },
        runtimeDistribution: createRuntimeDistribution(),
        runtimeStarter: unusedRuntimeStarter,
        taskEventPublicationReporter: { report: () => Effect.void },
        taskStore: createTaskStoreTestDouble({}),
        terminalPty,
      }),
    );

    try {
      await Effect.runPromise(router.initialize());

      const payload = mcpBridgeDiscoveryFileSchema.parse(
        parseJson(
          await readFile(
            path.join(
              configDir,
              "runtime",
              "dev-instances",
              "browser-0123456789ab",
              "mcp-bridge.json",
            ),
            "utf8",
          ),
        ),
      );
      expect(payload).toEqual({
        hostToken: expect.any(String),
        hostUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
        pid: process.pid,
      });
      await expect(
        readFile(path.join(configDir, "runtime", "mcp-bridge.json"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await Effect.runPromise(router.dispose());
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("writes live-session faults through the error lifecycle logger", async () => {
    const { errors, infos, logger } = createLogger();

    await Effect.runPromise(createLiveSessionFaultLogger(logger)("agent-session-live.fault {...}"));

    expect(errors).toEqual(["agent-session-live.fault {...}"]);
    expect(infos).toEqual([]);
  });

  test("stops managed dev servers during normal host disposal", async () => {
    const { infos, logger } = createLogger();

    const router = await createRouter({ logger });
    await Effect.runPromise(router.dispose());

    expect(infos).toContain("No dev servers are running");
  });

  test("disposes SQLite task store connections after every other host resource", async () => {
    const { infos, logger } = createLogger();

    const router = await createRouter({ logger });
    await Effect.runPromise(router.dispose());

    expect(infos.at(-2)).toBe("Stopped SQLite task store connections");
    expect(infos.at(-1)).toBe("OpenDucktor host services stopped");
  });

  test("stops the pull request sync loop during host disposal", async () => {
    const { infos, logger } = createLogger();
    const router = await createRouter({ eventBus: createEventBus(), logger });

    await Effect.runPromise(router.initialize());
    await Effect.runPromise(router.dispose());

    expect(infos).toContain("Stopping pull request sync loop...");
    expect(infos).toContain("Pull request sync loop stopped");
    expect(infos).toContain("Stopped pull request sync loop");
  });

  test("starts enabled runtimes when the MCP host bridge fails to start", async () => {
    const { errors, logger } = createLogger();
    const starter = createRuntimeStarter();
    const router = await createRouter({
      logger,
      runtimeStarter: starter,
      mcpHostBridge: {
        ...createMcpHostBridge(),
        ensureExternalDiscoveryReady: () =>
          Effect.fail(
            new HostOperationError({ operation: "test.bridge", message: "EACCES: discovery file" }),
          ),
      },
    });
    try {
      await Effect.runPromise(router.initialize());
      await waitForRuntimeState(router, "opencode", "ready");

      expect(starter.starts.map((input) => input.runtimeKind)).toEqual(["opencode"]);
      expect(errors).toContain(
        "The OpenDucktor MCP host bridge did not start: EACCES: discovery file",
      );
    } finally {
      await Effect.runPromise(router.dispose());
    }
  });

  test("starts enabled runtimes at host initialization and publishes their status", async () => {
    const { logger } = createLogger();
    const published: HostEventEnvelope[] = [];
    const starter = createRuntimeStarter();
    const router = await createRouter({
      eventBus: { ...createEventBus(), publish: (envelope) => void published.push(envelope) },
      logger,
      runtimeStarter: starter,
    });
    try {
      await Effect.runPromise(router.initialize());
      await waitForRuntimeState(router, "opencode", "ready");

      expect(starter.starts.map((input) => input.runtimeKind)).toEqual(["opencode"]);
      expect(
        published
          .filter((envelope) => envelope.channel === "openducktor://runtime-changed")
          .map((envelope) => envelope.payload),
      ).toContainEqual({
        type: "runtime_changed",
        hostInstanceId: expect.any(String),
        status: expect.objectContaining({
          kind: "opencode",
          state: "ready",
          trigger: "host_startup",
          runtimeId: "opencode-1",
        }),
      });
      await expect(
        Effect.runPromise(router.invoke("runtime_require", { runtimeKind: "opencode" })),
      ).resolves.toMatchObject({ kind: "opencode", runtimeId: "opencode-1" });
    } finally {
      await Effect.runPromise(router.dispose());
    }
    expect(starter.stops).toEqual(["opencode-1"]);
  });

  test("disposes host resources when the lifecycle logger rejects", async () => {
    const persistenceError = new Error(
      "openducktor.logs.append failed for /tmp/openducktor-host.log",
    );
    const logger: HostLifecycleLogger = {
      error: () => Effect.fail(persistenceError),
      info: () => Effect.fail(persistenceError),
    };
    const starter = createRuntimeStarter();
    const router = await startRouterWithRuntime(logger, starter);

    const exit = await Effect.runPromiseExit(router.dispose());

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Array.from(Cause.failures(exit.cause))[0]).toMatchObject({
        _tag: "HostOperationError",
        cause: persistenceError,
      });
    }
    expect(starter.stops).toEqual(["opencode-1"]);
  });

  test("does not log successful disposal when a shutdown step fails", async () => {
    const { infos, logger } = createLogger();
    const router = await startRouterWithRuntime(logger, createFailingStopStarter());

    const exit = await Effect.runPromiseExit(router.dispose());

    expect(exit._tag).toBe("Failure");
    expect(infos).not.toContain("OpenDucktor host services stopped");
  });

  test("preserves shutdown and lifecycle logging failures together", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const logger: HostLifecycleLogger = {
      error: () => Effect.fail(persistenceError),
      info: () => Effect.fail(persistenceError),
    };
    const router = await startRouterWithRuntime(logger, createFailingStopStarter());

    const exit = await Effect.runPromiseExit(router.dispose());

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Array.from(Cause.failures(exit.cause))[0]).toMatchObject({
        _tag: "HostOperationError",
        operation: "host.dispose",
        details: {
          shutdownFailure: expect.objectContaining({
            operation: "host.shutdown",
            message: expect.stringContaining("runtime child is still running"),
          }),
          loggingFailures: [expect.objectContaining({ cause: persistenceError })],
        },
      });
    }
  });
});

const createFailingStopStarter = () =>
  createRuntimeStarter(() =>
    Effect.fail(
      new HostOperationError({
        operation: "test.runtime.stop",
        message: "runtime child is still running",
      }),
    ),
  );

const waitForRuntimeState = async (
  router: EffectNodeHostCommandRouter,
  kind: string,
  state: string,
): Promise<void> => {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const snapshot = hostRuntimeSnapshotSchema.parse(
      await Effect.runPromise(router.invoke("runtime_status")),
    );
    if (snapshot.runtimes.some((runtime) => runtime.kind === kind && runtime.state === state)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for the ${kind} runtime to become ${state}.`);
};

/** Creates a router whose saved settings enable OpenCode, then waits for the startup runtime. */
const startRouterWithRuntime = async (
  logger: HostLifecycleLogger,
  runtimeStarter: RuntimeStarterPort,
): Promise<EffectNodeHostCommandRouter> => {
  const router = await createRouter({ logger, runtimeStarter });
  await Effect.runPromise(router.initialize().pipe(Effect.ignore));
  await waitForRuntimeState(router, "opencode", "ready");
  return router;
};
