import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cause, Effect } from "effect";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { createSourceRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import { HostOperationError } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { TerminalPtyPort } from "../../ports/terminal-pty-port";
import type { HostLifecycleLogger } from "../host-lifecycle";
import {
  type CreateNodeHostCommandRouterInput,
  createNodeEffectHostCommandRouter,
} from "./create-node-host-command-router";

const runtimeDistribution = createSourceRuntimeDistribution(
  path.resolve(import.meta.dir, "../../../../.."),
);

const createRuntimeRegistry = (
  stopAllRuntimes: RuntimeRegistryPort["stopAllRuntimes"] = () => Effect.succeed([]),
): RuntimeRegistryPort =>
  ({
    stopAllRuntimes,
  }) as unknown as RuntimeRegistryPort;

const createMcpHostBridge = (): McpHostBridgeServer =>
  ({
    ensureConnection: () => Effect.succeed({ baseUrl: "http://127.0.0.1:5000" }),
    ensureExternalDiscoveryReady: () => Effect.succeed({ baseUrl: "http://127.0.0.1:5000" }),
    close: () => Effect.succeed({ baseUrl: null, closed: false }),
  }) as unknown as McpHostBridgeServer;

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

const createRouter = (input: {
  eventBus?: HostEventBusPort;
  logger: HostLifecycleLogger;
  onBackgroundFailure?: CreateNodeHostCommandRouterInput["onBackgroundFailure"];
  runtimeRegistry?: RuntimeRegistryPort;
}) =>
  createNodeEffectHostCommandRouter({
    ...(input.eventBus ? { eventBus: input.eventBus } : {}),
    lifecycleLogger: input.logger,
    mcpBridgeDiscoveryMode: "production",
    mcpHostBridge: createMcpHostBridge(),
    onBackgroundFailure: input.onBackgroundFailure ?? (() => Effect.void),
    taskEventPublicationReporter: { report: () => Effect.void },
    runtimeDistribution,
    runtimeRegistry: input.runtimeRegistry ?? createRuntimeRegistry(),
    taskStore: {} as TaskStorePort,
    terminalPty,
  });

describe("createNodeEffectHostCommandRouter", () => {
  test("publishes development discovery from composition mode despite ambient channel", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-node-host-discovery-"));
    const { logger } = createLogger();
    const router = createNodeEffectHostCommandRouter({
      lifecycleLogger: logger,
      mcpBridgeDiscoveryMode: "development",
      onBackgroundFailure: () => Effect.void,
      processEnv: {
        OPENDUCKTOR_CHANNEL: "production",
        OPENDUCKTOR_CONFIG_DIR: configDir,
      },
      runtimeDistribution,
      runtimeRegistry: createRuntimeRegistry(),
      taskStore: {} as TaskStorePort,
      terminalPty,
    });

    try {
      await Effect.runPromise(router.initialize());

      const payload = JSON.parse(
        await readFile(path.join(configDir, "runtime", "mcp-bridge-dev.json"), "utf8"),
      ) as Record<string, unknown>;
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

  test("stops managed dev servers during normal host disposal", async () => {
    const { infos, logger } = createLogger();

    await Effect.runPromise(createRouter({ logger }).dispose());

    expect(infos).toContain("No dev servers are running");
  });

  test("stops the pull request sync loop during host disposal", async () => {
    const { infos, logger } = createLogger();
    const router = createRouter({ eventBus: createEventBus(), logger });

    await Effect.runPromise(router.initialize());
    await Effect.runPromise(router.dispose());

    expect(infos).toContain("Stopping pull request sync loop...");
    expect(infos).toContain("Pull request sync loop stopped");
    expect(infos).toContain("Stopped pull request sync loop");
  });

  test("disposes host resources when the lifecycle logger rejects", async () => {
    const persistenceError = new Error(
      "openducktor.logs.append failed for /tmp/openducktor-host.log",
    );
    let stopRuntimeCalls = 0;
    const logger: HostLifecycleLogger = {
      error: () => Effect.fail(persistenceError),
      info: () => Effect.fail(persistenceError),
    };
    const runtimeRegistry = createRuntimeRegistry(() =>
      Effect.sync(() => {
        stopRuntimeCalls += 1;
        return [];
      }),
    );

    const exit = await Effect.runPromiseExit(createRouter({ logger, runtimeRegistry }).dispose());

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Array.from(Cause.failures(exit.cause))[0]).toMatchObject({
        _tag: "HostOperationError",
        cause: persistenceError,
      });
    }

    expect(stopRuntimeCalls).toBe(1);
  });

  test("does not log successful disposal when a shutdown step fails", async () => {
    const { infos, logger } = createLogger();
    const runtimeFailure = new Error("runtime child is still running");
    const runtimeRegistry = createRuntimeRegistry(() =>
      Effect.fail(
        new HostOperationError({
          operation: "runtimeRegistry.stopAllRuntimes",
          message: runtimeFailure.message,
          cause: runtimeFailure,
        }),
      ),
    );

    const exit = await Effect.runPromiseExit(createRouter({ logger, runtimeRegistry }).dispose());

    expect(exit._tag).toBe("Failure");
    expect(infos).not.toContain("OpenDucktor host services stopped");
  });

  test("preserves shutdown and lifecycle logging failures together", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const runtimeFailure = new HostOperationError({
      operation: "runtimeRegistry.stopAllRuntimes",
      message: "runtime child is still running",
    });
    const logger: HostLifecycleLogger = {
      error: () => Effect.fail(persistenceError),
      info: () => Effect.fail(persistenceError),
    };
    const runtimeRegistry = createRuntimeRegistry(() => Effect.fail(runtimeFailure));

    const exit = await Effect.runPromiseExit(createRouter({ logger, runtimeRegistry }).dispose());

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Array.from(Cause.failures(exit.cause))[0]).toMatchObject({
        _tag: "HostOperationError",
        operation: "host.dispose",
        details: {
          shutdownFailure: expect.objectContaining({ operation: "host.shutdown" }),
          loggingFailures: [expect.objectContaining({ cause: persistenceError })],
        },
      });
    }
  });
});
