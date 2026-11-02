import { createHostEventBus } from "../../events/host-event-bus";
import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type HostEventEnvelope,
  hostRuntimeSnapshotSchema,
  mcpBridgeDiscoveryFileSchema,
  repoConfigSchema,
} from "@openducktor/contracts";
import { Cause, Deferred, Effect } from "effect";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { createSourceRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import { HostOperationError } from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { RuntimeStartInput, RuntimeStarterPort } from "../../ports/runtime-registry-port";
import { createBrowserEngineTestDouble } from "../../test-support/browser-engine-test-double";
import { createSharedSettingsFixture } from "../../test-support/shared-settings-fixture";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { createDefaultGlobalConfig } from "../../config/global-config";
import type { TerminalPtyPort } from "../../ports/terminal-pty-port";
import type { HostLifecycleLogger } from "../host-lifecycle";
import { createNodeEffectHostCommandRouter } from "./create-node-effect-host-command-router";
import { createNodeHostCommandRouter } from "./create-node-host-command-router-promise";
import { findHostStorageStartupError } from "./host-startup-storage-error";
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
  readVersion: () => Effect.succeed(null),
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

const createEventBus = (): HostEventBusPort => createHostEventBus({ report: () => {} });

const browserEngine = () => Effect.succeed(createBrowserEngineTestDouble().engine);
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
  browserEngine,
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
  browserEngine,
});

const routerDirectories: string[] = [];
afterEach(async () => {
  for (const directory of routerDirectories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const createRouter = async (input: {
  configRoot?: string;
  eventBus?: HostEventBusPort;
  logger: HostLifecycleLogger;
  onBackgroundFailure?: CreateNodeHostCommandRouterInput["onBackgroundFailure"];
  /** Enables OpenCode in saved settings and starts it with this starter. */
  runtimeStarter?: RuntimeStarterPort;
  mcpHostBridge?: McpHostBridgeServer;
}) => {
  const configRoot =
    input.configRoot ?? (await mkdtemp(path.join(tmpdir(), "odt-router-storage-")));
  routerDirectories.push(configRoot);
  const routerInput: Parameters<typeof createNodeEffectHostCommandRouter>[0] = {
    configDirScope: "test",
    lifecycleLogger: input.logger,
    mcpBridgeDiscoveryMode: "production",
    mcpHostBridge: input.mcpHostBridge ?? createMcpHostBridge(),
    onBackgroundFailure: input.onBackgroundFailure ?? (() => Effect.void),
    processEnv: { ...process.env, OPENDUCKTOR_CONFIG_DIR: configRoot },
    taskEventPublicationReporter: { report: () => Effect.void },
    runtimeDistribution: createRuntimeDistribution(),
    runtimeHealth,
    runtimeStarter: input.runtimeStarter ?? unusedRuntimeStarter,
    taskStore: createTaskStoreTestDouble({}),
    terminalPty,
    browserEngine,
  };
  if (input.runtimeStarter) {
    const config = createDefaultGlobalConfig();
    config.agentRuntimes.opencode = {
      ...config.agentRuntimes.opencode,
      enabled: true,
      executablePath: "opencode",
    };
    await writeFile(path.join(configRoot, "config.json"), JSON.stringify(config));
  }
  if (input.eventBus) {
    routerInput.eventBus = input.eventBus;
  }
  return Effect.runPromise(createNodeEffectHostCommandRouter(routerInput));
};

describe("createNodeEffectHostCommandRouter", () => {
  test("backs up settings and finishes preference migration before startup returns", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt-startup-settings-"));
    const configPath = path.join(configRoot, "config.json");
    const config = createDefaultGlobalConfig();
    config.theme = "dark";
    config.git.defaultMergeMethod = "squash";
    const original = JSON.stringify(config, null, 4) + "\n";
    await writeFile(configPath, original);
    const routers = await Promise.all([
      createRouter({ configRoot, logger: createLogger().logger }),
      createRouter({ configRoot, logger: createLogger().logger }),
    ]);
    try {
      const preferences = JSON.parse(await readFile(configPath, "utf8"));
      expect(preferences).toMatchObject({ version: 5, theme: "dark" });
      expect(preferences).not.toHaveProperty("git");
      expect(preferences).not.toHaveProperty("agentRuntimes");
      expect(await readFile(`${configPath}.backup`, "utf8")).toBe(original);
      for (const router of routers) {
        expect(
          await Effect.runPromise(router.invoke("workspace_get_settings_snapshot", {})),
        ).toMatchObject({ theme: "dark", git: { defaultMergeMethod: "squash" } });
      }
      await Effect.runPromise(routers[0]!.invoke("set_theme", { theme: "light" }));
      expect(await readFile(`${configPath}.backup`, "utf8")).toBe(original);
    } finally {
      await Promise.all(routers.map((router) => Effect.runPromise(router.dispose())));
    }
  });

  test("stops on backup failure and resumes without importing shared data again", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt-settings-recovery-"));
    const configPath = path.join(configRoot, "config.json");
    const backupPath = `${configPath}.backup`;
    const config = createDefaultGlobalConfig();
    config.git.defaultMergeMethod = "squash";
    const original = JSON.stringify(config);
    await writeFile(configPath, original);
    await mkdir(backupPath);
    const failure = await createRouter({ configRoot, logger: createLogger().logger }).catch(
      (cause: unknown) => cause,
    );
    // Shells show this error in their startup error view.
    expect(findHostStorageStartupError(failure)?.message).toContain(backupPath);
    expect(await readFile(configPath, "utf8")).toBe(original);
    await rm(backupPath, { recursive: true });
    config.git.defaultMergeMethod = "rebase";
    config.theme = "dark";
    const corrected = JSON.stringify(config);
    await writeFile(configPath, corrected);
    const router = await createRouter({ configRoot, logger: createLogger().logger });
    try {
      expect(
        await Effect.runPromise(router.invoke("workspace_get_settings_snapshot", {})),
      ).toMatchObject({ theme: "dark", git: { defaultMergeMethod: "squash" } });
      expect(await readFile(backupPath, "utf8")).toBe(corrected);
      expect(JSON.parse(await readFile(configPath, "utf8")).version).toBe(5);
    } finally {
      await Effect.runPromise(router.dispose());
    }
  });

  // An interrupted rewrite leaves a backup with the same text. A different backup stops startup.
  test("finishes an interrupted settings rewrite and keeps the first backup", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt-settings-rewrite-"));
    const configPath = path.join(configRoot, "config.json");
    const config = createDefaultGlobalConfig();
    config.git.defaultMergeMethod = "squash";
    const fixture = await createSharedSettingsFixture({ configPath, config });
    await fixture.cleanup();
    config.git.defaultMergeMethod = "rebase";
    config.theme = "dark";
    const backup = JSON.stringify(config);
    await writeFile(configPath, backup);
    await writeFile(`${configPath}.backup`, backup);
    const router = await createRouter({ configRoot, logger: createLogger().logger });
    try {
      expect(
        await Effect.runPromise(router.invoke("workspace_get_settings_snapshot", {})),
      ).toMatchObject({ theme: "dark", git: { defaultMergeMethod: "squash" } });
      expect(await readFile(`${configPath}.backup`, "utf8")).toBe(backup);
      expect(JSON.parse(await readFile(configPath, "utf8")).version).toBe(5);
    } finally {
      await Effect.runPromise(router.dispose());
    }
  });

  test("only restores sessions for an added or reopened workspace", async () => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "openducktor-workspace-selection-")),
    );
    const repoPath = path.join(root, "selected");
    const previousRepoPath = path.join(root, "previous");
    const addedRepoPath = path.join(root, "added");
    const closedRepoPath = path.join(root, "closed");
    await Promise.all(
      [repoPath, previousRepoPath, addedRepoPath, closedRepoPath].map((repo) => mkdir(repo)),
    );
    await Promise.all(
      [repoPath, previousRepoPath, addedRepoPath, closedRepoPath].map((repo) =>
        promisify(execFile)("git", ["init", repo]),
      ),
    );
    // Session restoration reads the saved roots and publishes one snapshot for the repository.
    const restored: string[] = [];
    const observations = new Map(
      [addedRepoPath, closedRepoPath].map((repo) => [repo, Deferred.makeUnsafe<void>()]),
    );
    const config = createDefaultGlobalConfig();
    config.workspaces = {
      previous: repoConfigSchema.parse({
        workspaceId: "previous",
        workspaceName: "Previous",
        repoPath: previousRepoPath,
        agentStudioState: { openTaskIds: [] },
      }),
      selected: repoConfigSchema.parse({
        workspaceId: "selected",
        workspaceName: "Selected",
        repoPath,
        agentStudioState: { openTaskIds: [] },
      }),
      closed: repoConfigSchema.parse({
        workspaceId: "closed",
        workspaceName: "Closed",
        repoPath: closedRepoPath,
        closed: true,
      }),
    };
    config.activeWorkspace = "previous";
    await mkdir(path.join(root, "config"));
    await writeFile(path.join(root, "config", "config.json"), JSON.stringify(config));
    const { logger } = createLogger();
    const router = await Effect.runPromise(
      createNodeEffectHostCommandRouter({
        configDirScope: "test",
        lifecycleLogger: logger,
        eventBus: {
          ...createEventBus(),
          publish: (envelope) => {
            if (
              envelope.channel === "openducktor://agent-session-live-event" &&
              envelope.payload.type === "snapshot"
            ) {
              restored.push(envelope.payload.repoPath);
              const observed = observations.get(envelope.payload.repoPath);
              if (observed) Effect.runSync(Deferred.succeed(observed, undefined));
            }
          },
        },
        mcpBridgeDiscoveryMode: "production",
        mcpHostBridge: createMcpHostBridge(),
        onBackgroundFailure: () => Effect.void,
        processEnv: { ...process.env, OPENDUCKTOR_CONFIG_DIR: path.join(root, "config") },
        runtimeDistribution: createRuntimeDistribution(),
        runtimeHealth,
        runtimeStarter: unusedRuntimeStarter,
        taskEventPublicationReporter: { report: () => Effect.void },
        taskStore: createTaskStoreTestDouble({ listTasks: () => Effect.succeed([]) }),
        terminalPty,
        browserEngine,
      }),
    );
    const selected = Effect.runPromiseExit(
      router.invoke("workspace_select", { workspaceId: "selected" }),
    );
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        selected,
        new Promise<"blocked">((resolve) => {
          deadline = setTimeout(() => resolve("blocked"), 500);
        }),
      ]);
      expect(result).not.toBe("blocked");
      expect(result).toMatchObject({
        _tag: "Success",
        value: { workspaceId: "selected", repoPath },
      });
      expect(
        parseJson(await readFile(path.join(root, "config", "config.json"), "utf8")),
      ).toMatchObject({ activeWorkspace: "selected", version: 5 });
      await Effect.runPromise(router.invoke("set_theme", { theme: "dark" }));
      await Effect.runPromise(
        router.invoke("workspace_reorder", { workspaceOrder: ["selected", "previous"] }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(restored).toEqual([]);
      await Effect.runPromise(
        router.invoke("workspace_add", {
          workspaceId: "added",
          workspaceName: "Added",
          repoPath: addedRepoPath,
        }),
      );
      await Effect.runPromise(
        Deferred.await(observations.get(addedRepoPath)!).pipe(Effect.timeout("1 second")),
      );
      await Effect.runPromise(
        router.invoke("workspace_reopen", {
          workspaceId: "closed",
          expectedRepoPath: closedRepoPath,
        }),
      );
      await Effect.runPromise(
        Deferred.await(observations.get(closedRepoPath)!).pipe(Effect.timeout("1 second")),
      );
    } finally {
      clearTimeout(deadline);
      await selected;
      await Effect.runPromise(router.dispose());
      await rm(root, { recursive: true, force: true });
    }
    expect(restored).toEqual([addedRepoPath, closedRepoPath]);
  });

  test("tool catalog requests reach the runtime readiness check", async () => {
    const { logger } = createLogger();
    const router = await createRouter({ logger });
    try {
      const result = await Effect.runPromise(
        router
          .invoke("agent_runtime_claude_tool_catalog", {
            input: { runtimeId: "claude-unavailable" },
          })
          .pipe(Effect.result),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toMatchObject({
          _tag: "HostResourceError",
          resource: "agent_runtime",
          operation: "runtime.requireReady",
        });
      }
    } finally {
      await Effect.runPromise(router.dispose());
    }
  });

  test("returns synchronous setup faults through the Effect channel", async () => {
    const result = await Effect.runPromise(
      createNodeEffectHostCommandRouter(createFailingRouterInput()).pipe(Effect.result),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toEqual(
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
        browserEngine,
      }).pipe(Effect.result),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toEqual(
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
      createNodeEffectHostCommandRouter(createAssemblyFailingRouterInput()).pipe(Effect.result),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toEqual(
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
    const router = await Effect.runPromise(
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
        browserEngine,
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

  test("disposes the host database connection after every other host resource", async () => {
    const { infos, logger } = createLogger();

    const router = await createRouter({ logger });
    await Effect.runPromise(router.dispose());

    expect(infos.at(-2)).toBe("Stopped host database connection");
    expect(infos.at(-1)).toBe("OpenDucktor host services stopped");
  });

  test("stops the task sync loop during host disposal", async () => {
    const { infos, logger } = createLogger();
    const router = await createRouter({ eventBus: createEventBus(), logger });

    await Effect.runPromise(router.initialize());
    await Effect.runPromise(router.dispose());

    expect(infos).toContain("Stopping task sync loop...");
    expect(infos).toContain("Task sync loop stopped");
    expect(infos).toContain("Stopped task sync loop");
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
      expect(
        exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)[0],
      ).toMatchObject({
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
      expect(
        exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)[0],
      ).toMatchObject({
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
