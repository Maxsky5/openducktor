import { unexpectedSessionImport } from "../../test-support/session-import-test-doubles";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_DESCRIPTORS_BY_KIND, type RuntimeInstanceSummary } from "@openducktor/contracts";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { terminateProcessTree } from "../../infrastructure/process/process-tree";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type {
  PreparedRuntimeLiveSessionAdapter,
  RuntimeLiveSessionLifecyclePort,
} from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeStartInput } from "../../ports/runtime-registry-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryId, ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { writeFakeRuntimeCommand } from "../../test-support/fake-runtime-command";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { createSystemCommandRunner } from "../system/system-command-runner";
import { createToolDiscoveryAdapter } from "../system/tool-discovery";
import type { OpenCodeLiveSessionObserver } from "../agent-sessions/opencode-live-session-adapter";
import { createOpenCodeRuntimeStarter as createEffectOpenCodeRuntimeStarter } from "./opencode-runtime-starter";

type OpenCodeRuntimeStarterInput = Parameters<typeof createEffectOpenCodeRuntimeStarter>[0];
type OpenCodeRuntimeStarterTestInput = Omit<
  OpenCodeRuntimeStarterInput,
  "liveSessionLifecycle" | "prepareLiveSessionAdapter" | "launchDirectory" | "toolDiscovery"
> &
  Partial<
    Pick<
      OpenCodeRuntimeStarterInput,
      "liveSessionLifecycle" | "prepareLiveSessionAdapter" | "launchDirectory" | "toolDiscovery"
    >
  > & {
    systemCommands?: SystemCommandPort;
  };
type OwnedCleanup = Parameters<RuntimeStartInput["ownCleanup"]>[0];
const startInput = (
  configuredExecutablePath: string,
  onRuntimeExit: (message: string) => void = () => undefined,
  onRuntimeCleanupFailed: (cause: string) => void = () => undefined,
  ownedCleanups: OwnedCleanup[] = [],
) => ({
  runtimeKind: "opencode" as const,
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
  configuredExecutablePath,
  ownCleanup: (cleanup: OwnedCleanup) => {
    ownedCleanups.push(cleanup);
  },
  onRuntimeExit,
  onRuntimeCleanupFailed,
});
/** Runs the one cleanup that startup handed to the host, as the registry does after a failure. */
const runOwnedCleanup = (ownedCleanups: OwnedCleanup[]) => {
  expect(ownedCleanups).toHaveLength(1);
  const [cleanup] = ownedCleanups;
  if (!cleanup) throw new Error("Startup must hand its cleanup to the host.");
  return cleanup;
};
const createOpenCodeRuntimeStarter = (input: OpenCodeRuntimeStarterTestInput) => {
  const {
    launchDirectory,
    liveSessionLifecycle,
    prepareLiveSessionAdapter,
    readEnv,
    systemCommands,
    toolDiscovery,
    ...starterInput
  } = input;
  const defaultLifecycle: RuntimeLiveSessionLifecyclePort = {
    registerRuntimeAdapter: () => Effect.void,
    releaseRuntime: () => Effect.succeed([]),
    createRuntimeRegistration: (binding) =>
      new AgentSessionLiveRegistration(binding, (mutation) =>
        Effect.map(mutation, (result) => result.value),
      ),
  };
  const toolDiscoveryInput: Parameters<typeof createToolDiscoveryAdapter>[0] = {
    systemCommands: systemCommands ?? createSystemCommands(),
  };
  if (readEnv !== undefined) {
    toolDiscoveryInput.readEnv = readEnv;
  }
  const effectiveToolDiscovery = toolDiscovery ?? createToolDiscoveryAdapter(toolDiscoveryInput);
  const runtimeStarterInput: Parameters<typeof createEffectOpenCodeRuntimeStarter>[0] = {
    launchDirectory: launchDirectory ?? tmpdir(),
    toolDiscovery: effectiveToolDiscovery,
    liveSessionLifecycle: liveSessionLifecycle ?? defaultLifecycle,
    prepareLiveSessionAdapter:
      prepareLiveSessionAdapter ??
      ((runtime) => {
        const adapter: AgentSessionLiveAdapterPort = {
          queries: unexpectedRuntimeQueries,
          sessionImport: unexpectedSessionImport,
          supportsSessionControl: false,
          beginGeneratedImageBatch: () => Effect.dieMessage("Unexpected beginGeneratedImageBatch"),
          releaseGeneratedImageBatch: () =>
            Effect.dieMessage("Unexpected releaseGeneratedImageBatch"),
          describeGeneratedImages: () => Effect.dieMessage("Unexpected describeGeneratedImages"),
          resolveGeneratedImageSource: () => Effect.dieMessage("Unexpected generated image read"),
          binding: new AgentSessionLiveRegistration(
            { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
            (mutation) => Effect.map(mutation, ({ value }) => value),
          ),
          listSnapshots: () => Effect.succeed([]),
          readSnapshot: (ref) => Effect.succeed({ type: "missing", ref }),
          loadContext: () => Effect.succeed(null),
          replyApproval: () => Effect.void,
          replyQuestion: () => Effect.void,
          releaseRuntime: () => Effect.succeed([]),
        };
        return Effect.succeed({
          adapter,
          startForwarding: () => Effect.void,
          discard: () => Effect.void,
        } satisfies PreparedRuntimeLiveSessionAdapter);
      }),
    ...starterInput,
  };
  if (readEnv !== undefined) {
    runtimeStarterInput.readEnv = readEnv;
  }
  return createEffectOpenCodeRuntimeStarter(runtimeStarterInput);
};
const createSystemCommands = (): SystemCommandPort => ({
  resolveCommandPath(command) {
    return Effect.succeed(command);
  },
  versionCommand() {
    return Effect.succeed("opencode 1.0.0");
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: true, stdout: "", stderr: "" });
  },
});

const createFakeToolDiscovery = (
  paths: Partial<Record<ToolDiscoveryId, string>>,
): ToolDiscoveryPort => ({
  discoverTool(toolId) {
    return this.resolveTool(toolId);
  },
  resolveTool(toolId) {
    const path = paths[toolId];
    return path === undefined
      ? Effect.dieMessage(`Missing fake tool path for ${toolId}`)
      : Effect.succeed({
          displayLabel: "Test tool",
          path,
          sourceCategory: "provided_path",
        });
  },
  resolveToolPath(toolId) {
    const path = paths[toolId];
    return path === undefined
      ? Effect.dieMessage(`Missing fake tool path for ${toolId}`)
      : Effect.succeed(path);
  },
  validateToolPath(toolId, executablePath) {
    const expectedPath = paths[toolId];
    return expectedPath === executablePath
      ? Effect.succeed({
          displayLabel: "Saved path",
          path: executablePath,
          sourceCategory: "provided_path",
        })
      : Effect.dieMessage(`Unexpected fake tool path for ${toolId}: ${executablePath}`);
  },
});

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
};

const PROCESS_CLEANUP_TIMEOUT_MS = 3_000;
const PROCESS_START_TIMEOUT_MS = 3_000;

const waitForProcessExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  try {
    await waitFor(() => !processIsAlive(pid), timeoutMs);
    return true;
  } catch {
    return false;
  }
};

const forceStopProcessTree = (pid: number) =>
  process.platform === "win32"
    ? terminateProcessTree({
        pid,
        label: `test process tree ${pid}`,
        isClosed: () => !processIsAlive(pid),
        waitForExit: (timeoutMs) =>
          Effect.tryPromise({
            try: () => waitForProcessExit(pid, timeoutMs),
            catch: (cause) =>
              new HostOperationError({
                operation: "test.forceStopProcessTree",
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
          }),
        stopTimeoutMs: 2_000,
      })
    : Effect.tryPromise({
        try: async () => {
          try {
            process.kill(pid, "SIGKILL");
          } catch (cause) {
            if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) {
              throw cause;
            }
          }
          await waitFor(() => !processIsAlive(pid), 2_000);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.forceStopProcessTree",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

const createFakeOpenCode = async (
  root: string,
  options: {
    childPidPath?: string;
    configCapturePath?: string;
    environmentCapturePath?: string;
    exitAfterMs?: number;
  } = {},
): Promise<string> => {
  const scriptPath = join(root, "opencode.mjs");
  await writeFile(
    scriptPath,
    `import { spawn } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] !== "serve") {
  console.error("expected serve command");
  process.exit(2);
}
const portFlagIndex = args.indexOf("--port");
if (Number(args[portFlagIndex + 1]) !== 43123) {
  console.error("unexpected port");
  process.exit(2);
}
const childPidPath = ${JSON.stringify(options.childPidPath ?? null)};
const configCapturePath = ${JSON.stringify(options.configCapturePath ?? null)};
const environmentCapturePath = ${JSON.stringify(options.environmentCapturePath ?? null)};
const exitAfterMs = ${JSON.stringify(options.exitAfterMs ?? null)};
if (configCapturePath) {
  writeFileSync(configCapturePath + ".tmp", process.env.OPENCODE_CONFIG_CONTENT ?? "");
  renameSync(configCapturePath + ".tmp", configCapturePath);
}
if (environmentCapturePath) {
  writeFileSync(environmentCapturePath + ".tmp", JSON.stringify({
    password: process.env.OPENCODE_SERVER_PASSWORD ?? null,
    username: process.env.OPENCODE_SERVER_USERNAME ?? null,
    configContent: process.env.OPENCODE_CONFIG_CONTENT ?? null,
    odtNames: Object.keys(process.env).filter((name) => name.startsWith("ODT_")).sort(),
    cwd: process.cwd(),
  }));
  renameSync(environmentCapturePath + ".tmp", environmentCapturePath);
}
if (childPidPath) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: "ignore",
  });
  writeFileSync(childPidPath, String(child.pid));
}
const keepAlive = setInterval(() => {}, 1000);
const stop = () => {
  clearInterval(keepAlive);
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
if (exitAfterMs !== null) {
  setTimeout(stop, exitAfterMs);
}
`,
  );
  return writeFakeRuntimeCommand(root, "opencode", "opencode.mjs");
};

const createLiveAdapter = (runtime: RuntimeInstanceSummary): AgentSessionLiveAdapterPort => ({
  queries: unexpectedRuntimeQueries,
  sessionImport: unexpectedSessionImport,
  supportsSessionControl: false,
  beginGeneratedImageBatch: () => Effect.dieMessage("Unexpected beginGeneratedImageBatch"),
  releaseGeneratedImageBatch: () => Effect.dieMessage("Unexpected releaseGeneratedImageBatch"),
  describeGeneratedImages: () => Effect.dieMessage("Unexpected describeGeneratedImages"),
  resolveGeneratedImageSource: () => Effect.dieMessage("Unexpected generated image read"),
  binding: new AgentSessionLiveRegistration(
    { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
    (mutation) => Effect.map(mutation, ({ value }) => value),
  ),
  listSnapshots: () => Effect.succeed([]),
  readSnapshot: (ref) => Effect.succeed({ type: "missing", ref }),
  loadContext: () => Effect.succeed(null),
  replyApproval: () => Effect.void,
  replyQuestion: () => Effect.void,
  releaseRuntime: () => Effect.succeed([]),
});

describe("createOpenCodeRuntimeStarter", () => {
  test("starts one shared OpenCode runtime without workspace binding and stops it", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-starter-"));
    try {
      const repo = join(root, "repo");
      // Windows locks the working directory of a process until it is fully gone, so the runtime
      // must not run inside the folder that this test deletes.
      const launchDirectory = tmpdir();
      const configCapturePath = join(root, "opencode-config.json");
      const environmentCapturePath = join(root, "opencode-environment.json");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, {
        configCapturePath,
        environmentCapturePath,
      });
      const portProbeCalls: number[] = [];
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        readEnv: () => ({
          ...process.env,
          OPENCODE_SERVER_PASSWORD: "inherited-password",
          OPENCODE_SERVER_USERNAME: "inherited-username",
          OPENCODE_CONFIG_CONTENT: '{"logLevel":"WARN"}',
          ODT_WORKSPACE_ID: "inherited-workspace",
          ODT_HOST_URL: "http://127.0.0.1:14327",
          ODT_HOST_TOKEN: "inherited-token",
          ODT_FORBID_WORKSPACE_ID_INPUT: "true",
          ODT_ALLOWED_TOOLS: "odt_read_task",
        }),
        launchDirectory,
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        startupTimeoutMs: 2000,
        retryDelayMs: 1,
        portAllocator: () =>
          Effect.tryPromise({
            try: async () => {
              return 43123;
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          }),
        readinessProbe: (port) =>
          Effect.tryPromise({
            try: async () => {
              portProbeCalls.push(port);
              return portProbeCalls.length === 3;
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          }),
        now: () => new Date("2026-05-10T10:00:00.000Z"),
        runtimeId: () => "runtime-1",
      });
      const exits: string[] = [];
      const handle = await Effect.runPromise(
        starter.startRuntime(startInput(opencodeBinary, (message) => exits.push(message))),
      );
      expect(handle.runtime).toEqual({
        kind: "opencode",
        runtimeId: "runtime-1",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:43123",
        },
        startedAt: "2026-05-10T10:00:00.000Z",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      });
      expect(handle.configuredExecutablePath).toBe(opencodeBinary);
      expect(handle.effectiveExecutablePath).toBe(opencodeBinary);
      expect(portProbeCalls).toEqual([43123, 43123, 43123]);
      await waitFor(() => existsSync(environmentCapturePath), PROCESS_START_TIMEOUT_MS);
      const { cwd, ...environment } = JSON.parse(await readFile(environmentCapturePath, "utf8"));
      expect(environment).toEqual({
        password: null,
        username: null,
        configContent: '{"logLevel":"WARN"}',
        odtNames: [],
      });
      // Compare resolved paths: Windows can report the short 8.3 name, macOS the /private path.
      expect(await realpath(cwd)).toBe(await realpath(launchDirectory));
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
      expect(exits).toEqual([]);
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("registers the live adapter before forwarding and returning the runtime handle", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-live-order-"));
    try {
      const repo = join(root, "repo");
      const configCapturePath = join(root, "opencode-config.json");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, { configCapturePath });
      const order: string[] = [];
      const releasedRuntimeIds: string[] = [];
      const lifecycle: RuntimeLiveSessionLifecyclePort = {
        registerRuntimeAdapter: (adapter) =>
          Effect.sync(() => {
            order.push(`register:${adapter.binding.runtimeId}`);
          }),
        releaseRuntime: (runtimeId) =>
          Effect.sync(() => {
            releasedRuntimeIds.push(runtimeId);
            return [];
          }),
        createRuntimeRegistration: (binding) =>
          new AgentSessionLiveRegistration(binding, (mutation) =>
            Effect.map(mutation, (result) => result.value),
          ),
      };
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        liveSessionLifecycle: lifecycle,
        prepareLiveSessionAdapter: (runtime) =>
          Effect.sync(() => {
            order.push(`prepare:${runtime.runtimeId}`);
            return {
              adapter: createLiveAdapter(runtime),
              startForwarding: () =>
                Effect.sync(() => {
                  order.push(`forward:${runtime.runtimeId}`);
                }),
              discard: () => Effect.void,
            };
          }),
        // The fake child can start slowly while the full suite runs in parallel.
        startupTimeoutMs: 4_000,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        // The fake child must start before the test stops its process tree on Windows.
        readinessProbe: () => Effect.sync(() => existsSync(configCapturePath)),
        runtimeId: () => "runtime-live-order",
      });

      const handle = await Effect.runPromise(starter.startRuntime(startInput(opencodeBinary)));
      order.push("returned");
      expect(order).toEqual([
        "prepare:runtime-live-order",
        "register:runtime-live-order",
        "forward:runtime-live-order",
        "returned",
      ]);

      await Effect.runPromise(handle.stop());
      expect(releasedRuntimeIds).toEqual(["runtime-live-order"]);
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("applies the startup deadline to live-session initialization after readiness", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-live-timeout-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        prepareLiveSessionAdapter: (runtime) =>
          Effect.sleep("100 millis").pipe(
            Effect.as({
              adapter: createLiveAdapter(runtime),
              startForwarding: () => Effect.void,
              discard: () => Effect.void,
            }),
          ),
        startupTimeoutMs: 20,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-live-timeout",
      });

      const result = await Effect.runPromise(
        Effect.either(starter.startRuntime(startInput(opencodeBinary))),
      );
      if (result._tag === "Right") {
        await Effect.runPromise(result.right.stop());
      }

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toBe(
          "Timed out starting OpenCode runtime on 127.0.0.1:43123 after 20ms.",
        );
      }
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("bounds readiness probing by the startup deadline", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-readiness-timeout-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        startupTimeoutMs: 40,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.sleep("50 millis").pipe(Effect.as(false)),
      });

      const startedAt = Date.now();
      await expect(
        Effect.runPromise(starter.startRuntime(startInput(opencodeBinary))),
      ).rejects.toThrow("Timed out waiting for OpenCode runtime on 127.0.0.1:43123.");

      expect(Date.now() - startedAt).toBeLessThan(500);
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("releases its live runtime and reports the exit once when the OpenCode process crashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-live-close-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, { exitAfterMs: 50 });
      const releasedRuntimeIds: string[] = [];
      const lifecycle: RuntimeLiveSessionLifecyclePort = {
        registerRuntimeAdapter: () => Effect.void,
        releaseRuntime: (runtimeId) =>
          Effect.sync(() => {
            releasedRuntimeIds.push(runtimeId);
            return [];
          }),
        createRuntimeRegistration: (binding) =>
          new AgentSessionLiveRegistration(binding, (mutation) =>
            Effect.map(mutation, (result) => result.value),
          ),
      };
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        liveSessionLifecycle: lifecycle,
        prepareLiveSessionAdapter: (runtime) =>
          Effect.succeed({
            adapter: createLiveAdapter(runtime),
            startForwarding: () => Effect.void,
            discard: () => Effect.void,
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-unexpected-close",
      });

      const exits: string[] = [];
      const handle = await Effect.runPromise(
        starter.startRuntime(startInput(opencodeBinary, (message) => exits.push(message))),
      );
      await waitFor(() => releasedRuntimeIds.length === 1, PROCESS_CLEANUP_TIMEOUT_MS);
      await waitFor(() => exits.length === 1, PROCESS_CLEANUP_TIMEOUT_MS);
      expect(releasedRuntimeIds).toEqual(["runtime-unexpected-close"]);
      expect(exits).toEqual(["process exited with code 0."]);
      await Effect.runPromise(handle.stop());
      expect(releasedRuntimeIds).toEqual(["runtime-unexpected-close"]);
      expect(exits).toHaveLength(1);
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("reports a failed live release after a crash as a cleanup failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-live-close-cleanup-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, { exitAfterMs: 50 });
      let releaseAttempts = 0;
      const lifecycle: RuntimeLiveSessionLifecyclePort = {
        registerRuntimeAdapter: () => Effect.void,
        releaseRuntime: () =>
          Effect.suspend(() => {
            releaseAttempts += 1;
            return releaseAttempts === 1
              ? Effect.fail(
                  new HostOperationError({ operation: "test.release", message: "adapter busy" }),
                )
              : Effect.succeed([]);
          }),
        createRuntimeRegistration: (binding) =>
          new AgentSessionLiveRegistration(binding, (mutation) =>
            Effect.map(mutation, (result) => result.value),
          ),
      };
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        liveSessionLifecycle: lifecycle,
        prepareLiveSessionAdapter: (runtime) =>
          Effect.succeed({
            adapter: createLiveAdapter(runtime),
            startForwarding: () => Effect.void,
            discard: () => Effect.void,
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-crash-cleanup",
      });

      const exits: string[] = [];
      const cleanupFailures: string[] = [];
      const handle = await Effect.runPromise(
        starter.startRuntime(
          startInput(
            opencodeBinary,
            (message) => exits.push(message),
            (cause) => cleanupFailures.push(cause),
          ),
        ),
      );
      await waitFor(() => cleanupFailures.length === 1, PROCESS_CLEANUP_TIMEOUT_MS);
      expect(exits).toHaveLength(1);
      expect(cleanupFailures[0]).toContain("adapter busy");

      // The failed release stays owned. The explicit stop retries it.
      await Effect.runPromise(handle.stop());
      expect(releaseAttempts).toBe(2);
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("reports a lost live observation once and ignores the later process exit", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-observation-lost-"));
    try {
      const opencodeBinary = await createFakeOpenCode(root, { exitAfterMs: 200 });
      const releasedRuntimeIds: string[] = [];
      let observer: OpenCodeLiveSessionObserver | null = null;
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        liveSessionLifecycle: {
          registerRuntimeAdapter: () => Effect.void,
          releaseRuntime: (runtimeId) =>
            Effect.sync(() => {
              releasedRuntimeIds.push(runtimeId);
              return [];
            }),
          createRuntimeRegistration: (binding) =>
            new AgentSessionLiveRegistration(binding, (mutation) =>
              Effect.map(mutation, (result) => result.value),
            ),
        },
        prepareLiveSessionAdapter: (runtime, liveObserver) =>
          Effect.sync(() => {
            observer = liveObserver;
            return {
              adapter: createLiveAdapter(runtime),
              startForwarding: () => Effect.void,
              discard: () => Effect.void,
            };
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-observation-lost",
      });
      const exits: string[] = [];
      const handle = await Effect.runPromise(
        starter.startRuntime(startInput(opencodeBinary, (message) => exits.push(message))),
      );
      if (!observer) throw new Error("Expected the starter to pass a live-session observer.");
      const liveObserver: OpenCodeLiveSessionObserver = observer;

      liveObserver.onObservationLost("OpenCode live event observation failed: connection lost");
      liveObserver.onObservationLost("OpenCode live event observation failed: again");
      expect(exits).toEqual(["OpenCode live event observation failed: connection lost"]);

      await waitFor(() => releasedRuntimeIds.length === 1, PROCESS_CLEANUP_TIMEOUT_MS);
      expect(exits).toHaveLength(1);
      await Effect.runPromise(handle.stop());
      expect(exits).toHaveLength(1);
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("does not report a lost live observation after a deliberate stop", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-observation-stop-"));
    try {
      const opencodeBinary = await createFakeOpenCode(root);
      let observer: OpenCodeLiveSessionObserver | null = null;
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        prepareLiveSessionAdapter: (runtime, liveObserver) =>
          Effect.sync(() => {
            observer = liveObserver;
            return {
              adapter: createLiveAdapter(runtime),
              startForwarding: () => Effect.void,
              discard: () => Effect.void,
            };
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-observation-stop",
      });
      const exits: string[] = [];
      const handle = await Effect.runPromise(
        starter.startRuntime(startInput(opencodeBinary, (message) => exits.push(message))),
      );
      if (!observer) throw new Error("Expected the starter to pass a live-session observer.");
      const liveObserver: OpenCodeLiveSessionObserver = observer;

      await Effect.runPromise(handle.stop());
      liveObserver.onObservationLost("OpenCode live event observation failed: aborted");

      expect(exits).toEqual([]);
    } finally {
      await removeTestDirectory(root);
    }
  });

  // This test starts a real fake runtime and waits for its process tree to stop.
  test("discards prepared observation when live-adapter registration fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-live-register-failure-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      let discardCalls = 0;
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        liveSessionLifecycle: {
          registerRuntimeAdapter: () =>
            Effect.fail(
              new HostOperationError({
                operation: "test.register-live-adapter",
                message: "live registration failed",
              }),
            ),
          releaseRuntime: () => Effect.succeed([]),
          createRuntimeRegistration: (binding) =>
            new AgentSessionLiveRegistration(binding, (mutation) =>
              Effect.map(mutation, (result) => result.value),
            ),
        },
        prepareLiveSessionAdapter: (runtime) =>
          Effect.succeed({
            adapter: createLiveAdapter(runtime),
            startForwarding: () => Effect.void,
            discard: () =>
              Effect.sync(() => {
                discardCalls += 1;
              }),
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-register-failure",
      });

      const ownedCleanups: OwnedCleanup[] = [];
      await expect(
        Effect.runPromise(
          starter.startRuntime(startInput(opencodeBinary, undefined, undefined, ownedCleanups)),
        ),
      ).rejects.toThrow("live registration failed");
      // The host runs the owned cleanup, which discards the unregistered adapter.
      expect(discardCalls).toBe(0);
      await Effect.runPromise(runOwnedCleanup(ownedCleanups));
      expect(discardCalls).toBe(1);
    } finally {
      await removeTestDirectory(root);
    }
  }, 10_000);

  test("removes a registered live adapter when forwarding startup fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-live-forward-failure-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const registeredRuntimeIds = new Set<string>();
      const releasedRuntimeIds: string[] = [];
      const lifecycle: RuntimeLiveSessionLifecyclePort = {
        registerRuntimeAdapter: (adapter) =>
          Effect.sync(() => {
            registeredRuntimeIds.add(adapter.binding.runtimeId);
          }),
        releaseRuntime: (runtimeId) =>
          Effect.sync(() => {
            registeredRuntimeIds.delete(runtimeId);
            releasedRuntimeIds.push(runtimeId);
            return [];
          }),
        createRuntimeRegistration: (binding) =>
          new AgentSessionLiveRegistration(binding, (mutation) =>
            Effect.map(mutation, (result) => result.value),
          ),
      };
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        liveSessionLifecycle: lifecycle,
        prepareLiveSessionAdapter: (runtime) =>
          Effect.succeed({
            adapter: createLiveAdapter(runtime),
            startForwarding: () =>
              Effect.fail(
                new HostOperationError({
                  operation: "test.start-forwarding",
                  message: "live forwarding failed",
                }),
              ),
            discard: () => Effect.void,
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-forward-failure",
      });

      const ownedCleanups: OwnedCleanup[] = [];
      await expect(
        Effect.runPromise(
          starter.startRuntime(startInput(opencodeBinary, undefined, undefined, ownedCleanups)),
        ),
      ).rejects.toThrow("live forwarding failed");
      await Effect.runPromise(runOwnedCleanup(ownedCleanups));
      expect(registeredRuntimeIds.size).toBe(0);
      expect(releasedRuntimeIds).toEqual(["runtime-forward-failure"]);
    } finally {
      await removeTestDirectory(root);
    }
    // Starts a real fake OpenCode process, which can outlast the host budget on Windows.
  }, 10_000);

  test("stops the OpenCode runtime process tree including descendants", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-starter-tree-"));
    let childPid: number | null = null;
    try {
      const repo = join(root, "repo");
      const childPidPath = join(root, "child.pid");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, { childPidPath });
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-tree",
      });

      const exits: string[] = [];
      const handle = await Effect.runPromise(
        starter.startRuntime(startInput(opencodeBinary, (message) => exits.push(message))),
      );
      await waitFor(() => existsSync(childPidPath), PROCESS_START_TIMEOUT_MS);
      childPid = Number(await readFile(childPidPath, "utf8"));
      expect(processIsAlive(childPid)).toBe(true);

      await Effect.runPromise(handle.stop());
      const stoppedPid = childPid;
      await waitFor(() => !processIsAlive(stoppedPid), PROCESS_CLEANUP_TIMEOUT_MS);
      expect(exits).toEqual([]);
    } finally {
      if (childPid !== null && processIsAlive(childPid)) {
        process.kill(childPid, "SIGKILL");
      }
      await removeTestDirectory(root);
    }
  });

  test("cleans up a spawned OpenCode process tree after startup timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-timeout-cleanup-"));
    let childPid: number | null = null;
    try {
      const repo = join(root, "repo");
      const childPidPath = join(root, "child.pid");
      const startupTimeoutMs = 2_000;
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, { childPidPath });
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        startupTimeoutMs,
        retryDelayMs: 2_000,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(false),
      });

      const ownedCleanups: OwnedCleanup[] = [];
      await Effect.runPromise(
        Effect.gen(function* () {
          const startup = yield* Effect.fork(
            Effect.either(
              starter.startRuntime(startInput(opencodeBinary, undefined, undefined, ownedCleanups)),
            ),
          );
          yield* Effect.gen(function* () {
            yield* Effect.promise(() =>
              waitFor(() => existsSync(childPidPath), PROCESS_START_TIMEOUT_MS),
            );
            childPid = Number(yield* Effect.promise(() => readFile(childPidPath, "utf8")));
            const timedOutPid = childPid;
            expect(processIsAlive(timedOutPid)).toBe(true);

            yield* TestClock.adjust(`${startupTimeoutMs} millis`);
            const result = yield* Fiber.join(startup);
            expect(result._tag).toBe("Left");
            if (result._tag === "Left") {
              expect(result.left.message).toBe(
                "Timed out waiting for OpenCode runtime on 127.0.0.1:43123.",
              );
            }
          }).pipe(Effect.ensuring(Fiber.interrupt(startup)));
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
      // The host runs the owned cleanup, which stops the timed-out process tree.
      await Effect.runPromise(runOwnedCleanup(ownedCleanups));
      const timedOutPid = childPid;
      if (timedOutPid === null) throw new Error("The fake OpenCode child did not start.");
      await waitFor(() => !processIsAlive(timedOutPid), PROCESS_CLEANUP_TIMEOUT_MS);
    } finally {
      if (childPid !== null && processIsAlive(childPid)) {
        process.kill(childPid, "SIGKILL");
      }
      await removeTestDirectory(root);
    }
  });

  test("reports OpenCode process-tree cleanup failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-cleanup-failure-"));
    let runtimePid: number | null = null;
    try {
      const repo = join(root, "repo");
      const configCapturePath = join(root, "opencode-config.json");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, { configCapturePath });
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        portAllocator: () => Effect.succeed(43123),
        // The child must own its working directory before cleanup tests stop it on Windows.
        readinessProbe: () => Effect.sync(() => existsSync(configCapturePath)),
        runtimeId: () => "runtime-failure",
        processTreeTerminator: ({ pid }) => {
          runtimePid = pid;
          return Effect.fail(
            new HostOperationError({
              operation: "test.processTreeTerminator",
              message: "process tree stayed alive",
            }),
          );
        },
      });

      const handle = await Effect.runPromise(starter.startRuntime(startInput(opencodeBinary)));

      await expect(Effect.runPromise(handle.stop())).rejects.toThrow("process tree stayed alive");
    } finally {
      if (runtimePid !== null && processIsAlive(runtimePid)) {
        await Effect.runPromise(forceStopProcessTree(runtimePid));
      }
      await removeTestDirectory(root);
    }
  });

  test("retries a failed process-tree stop instead of reporting a false success", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-cleanup-retry-"));
    let runtimePid: number | null = null;
    try {
      const configCapturePath = join(root, "opencode-config.json");
      const opencodeBinary = await createFakeOpenCode(root, { configCapturePath });
      let terminations = 0;
      const releases: string[] = [];
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.sync(() => existsSync(configCapturePath)),
        runtimeId: () => "runtime-retry",
        liveSessionLifecycle: {
          registerRuntimeAdapter: () => Effect.void,
          releaseRuntime: (runtimeId) =>
            Effect.sync(() => {
              releases.push(runtimeId);
              return [];
            }),
          createRuntimeRegistration: (binding) =>
            new AgentSessionLiveRegistration(binding, (mutation) =>
              Effect.map(mutation, (result) => result.value),
            ),
        },
        processTreeTerminator: (input) => {
          runtimePid = input.pid;
          terminations += 1;
          return terminations === 1
            ? Effect.fail(
                new HostOperationError({
                  operation: "test.processTreeTerminator",
                  message: "process tree stayed alive",
                }),
              )
            : terminateProcessTree(input);
        },
      });

      const handle = await Effect.runPromise(starter.startRuntime(startInput(opencodeBinary)));
      await expect(Effect.runPromise(handle.stop())).rejects.toThrow("process tree stayed alive");
      const pid = runtimePid;
      if (pid === null) throw new Error("The runtime did not start a process.");
      expect(processIsAlive(pid)).toBe(true);

      await Effect.runPromise(handle.stop());
      await waitFor(() => !processIsAlive(pid), PROCESS_CLEANUP_TIMEOUT_MS);
      expect(terminations).toBe(2);
      expect(releases).toEqual(["runtime-retry"]);
    } finally {
      if (runtimePid !== null && processIsAlive(runtimePid)) {
        await Effect.runPromise(forceStopProcessTree(runtimePid));
      }
      await removeTestDirectory(root);
    }
  });

  test("leaves a failed timeout cleanup to the owned cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-timeout-cleanup-failure-"));
    let runtimePid: number | null = null;
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        startupTimeoutMs: 20,
        retryDelayMs: 5,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(false),
        processTreeTerminator: ({ pid }) => {
          runtimePid = pid;
          return Effect.fail(
            new HostOperationError({
              operation: "test.processTreeTerminator",
              message: "process tree cleanup failed",
            }),
          );
        },
      });

      const ownedCleanups: OwnedCleanup[] = [];
      const failure = await Effect.runPromise(
        Effect.flip(
          starter.startRuntime(startInput(opencodeBinary, undefined, undefined, ownedCleanups)),
        ),
      );
      expect(failure.message).toBe("Timed out waiting for OpenCode runtime on 127.0.0.1:43123.");
      await expect(Effect.runPromise(runOwnedCleanup(ownedCleanups))).rejects.toThrow(
        "process tree cleanup failed",
      );
    } finally {
      if (runtimePid !== null && processIsAlive(runtimePid)) {
        await Effect.runPromise(forceStopProcessTree(runtimePid));
      }
      await removeTestDirectory(root);
    }
  });

  test("rejects an empty saved executable path before it starts a process", async () => {
    let portAllocations = 0;
    const starter = createOpenCodeRuntimeStarter({
      portAllocator: () =>
        Effect.sync(() => {
          portAllocations += 1;
          return 43123;
        }),
    });

    await expect(Effect.runPromise(starter.startRuntime(startInput("")))).rejects.toThrow(
      "Saved OpenCode path is empty",
    );
    expect(portAllocations).toBe(0);
  });

  // Windows starts a cmd shim and stops the resulting process tree.
  test("starts a Windows cmd OpenCode runtime from its saved path", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "odt-opencode-path-starter-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const startupPath = join(root, "opencode-started.json");
      const opencodeBinary = await createFakeOpenCode(root, { configCapturePath: startupPath });
      const pathWithFakeRuntime = `${root};${process.env.PATH ?? ""}`;
      const starter = createOpenCodeRuntimeStarter({
        systemCommands: createSystemCommandRunner({
          readEnv: () => ({ ...process.env, PATH: pathWithFakeRuntime, PATHEXT: ".CMD" }),
          platform: "win32",
        }),
        readEnv: () => ({ ...process.env, PATH: pathWithFakeRuntime, PATHEXT: ".CMD" }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.sync(() => existsSync(startupPath)),
        runtimeId: () => "runtime-path",
      });

      expect(opencodeBinary.endsWith(".cmd")).toBe(true);
      const handle = await Effect.runPromise(starter.startRuntime(startInput(opencodeBinary)));

      expect(handle.runtime.runtimeId).toBe("runtime-path");
      expect(existsSync(startupPath)).toBe(true);
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
    } finally {
      await removeTestDirectory(root);
    }
  }, 10_000);
});
