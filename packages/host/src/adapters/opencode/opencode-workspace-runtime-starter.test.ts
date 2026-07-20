import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { terminateProcessTree } from "../../infrastructure/process/process-tree";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type {
  PreparedRuntimeLiveSessionAdapter,
  RuntimeLiveSessionLifecyclePort,
} from "../../ports/runtime-live-session-lifecycle-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryId, ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { writeFakeRuntimeCommand } from "../../test-support/fake-runtime-command";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import { createSystemCommandRunner } from "../system/system-command-runner";
import { createToolDiscoveryAdapter } from "../system/tool-discovery";
import { createOpenCodeWorkspaceRuntimeStarter as createEffectOpenCodeWorkspaceRuntimeStarter } from "./opencode-workspace-runtime-starter";

type OpenCodeWorkspaceRuntimeStarterInput = Parameters<
  typeof createEffectOpenCodeWorkspaceRuntimeStarter
>[0];
type OpenCodeWorkspaceRuntimeStarterTestInput = Omit<
  OpenCodeWorkspaceRuntimeStarterInput,
  "liveSessionLifecycle" | "prepareLiveSessionAdapter" | "runtimeDistribution" | "toolDiscovery"
> &
  Partial<
    Pick<
      OpenCodeWorkspaceRuntimeStarterInput,
      "liveSessionLifecycle" | "prepareLiveSessionAdapter" | "runtimeDistribution" | "toolDiscovery"
    >
  > & {
    systemCommands?: SystemCommandPort;
  };
const testRuntimeDistribution = createArtifactRuntimeDistribution({
  mcpLauncher: {
    kind: "executable",
    executablePath: process.execPath,
  },
});
const createOpenCodeWorkspaceRuntimeStarter = (input: OpenCodeWorkspaceRuntimeStarterTestInput) => {
  const {
    liveSessionLifecycle,
    prepareLiveSessionAdapter,
    processEnv,
    systemCommands,
    toolDiscovery,
    ...starterInput
  } = input;
  const defaultLifecycle: RuntimeLiveSessionLifecyclePort = {
    registerRuntimeAdapter: () => Effect.void,
    releaseRuntime: () => Effect.succeed([]),
    runAdapterMutation: (mutation) => Effect.map(mutation, (result) => result.value),
  };
  return createEffectOpenCodeWorkspaceRuntimeStarter({
    runtimeDistribution: testRuntimeDistribution,
    toolDiscovery:
      toolDiscovery ??
      createToolDiscoveryAdapter({
        ...(processEnv === undefined ? {} : { env: processEnv }),
        systemCommands: systemCommands ?? createSystemCommands(),
      }),
    liveSessionLifecycle: liveSessionLifecycle ?? defaultLifecycle,
    prepareLiveSessionAdapter:
      prepareLiveSessionAdapter ??
      ((runtime) => {
        const adapter: AgentSessionLiveAdapterPort = {
          binding: {
            runtimeId: runtime.runtimeId,
            runtimeKind: runtime.kind,
            repoPath: runtime.repoPath,
          },
          matches: () => false,
          listRetainedSnapshots: () => Effect.succeed([]),
          readRetainedSnapshot: (ref) => Effect.succeed({ type: "missing", ref }),
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
    ...(processEnv === undefined ? {} : { processEnv }),
    ...starterInput,
  });
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
            if ((cause as NodeJS.ErrnoException).code !== "ESRCH") {
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
import { writeFileSync } from "node:fs";

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
  writeFileSync(configCapturePath, process.env.OPENCODE_CONFIG_CONTENT ?? "");
}
if (environmentCapturePath) {
  writeFileSync(environmentCapturePath, JSON.stringify({
    password: process.env.OPENCODE_SERVER_PASSWORD ?? null,
    username: process.env.OPENCODE_SERVER_USERNAME ?? null,
  }));
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
  binding: {
    runtimeId: runtime.runtimeId,
    runtimeKind: runtime.kind,
    repoPath: runtime.repoPath,
  },
  matches: () => false,
  listRetainedSnapshots: () => Effect.succeed([]),
  readRetainedSnapshot: (ref) => Effect.succeed({ type: "missing", ref }),
  loadContext: () => Effect.succeed(null),
  replyApproval: () => Effect.void,
  replyQuestion: () => Effect.void,
  releaseRuntime: () => Effect.succeed([]),
});

describe("createOpenCodeWorkspaceRuntimeStarter", () => {
  test("fails fast when the MCP bridge connection is not configured", async () => {
    const starter = createOpenCodeWorkspaceRuntimeStarter({
      systemCommands: createSystemCommands(),
    });
    await expect(
      Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      ),
    ).rejects.toThrow("OpenCode workspace startup requires an MCP host bridge connection.");
  });
  test("starts a reachable OpenCode workspace runtime and stops its process", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-starter-"));
    try {
      const repo = join(root, "repo");
      const configCapturePath = join(root, "opencode-config.json");
      const environmentCapturePath = join(root, "opencode-environment.json");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, {
        configCapturePath,
        environmentCapturePath,
      });
      const portProbeCalls: number[] = [];
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        processEnv: {
          ...process.env,
          OPENCODE_SERVER_PASSWORD: "inherited-password",
          OPENCODE_SERVER_USERNAME: "inherited-username",
        },
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.tryPromise({
            try: async () => {
              return {
                workspaceId: "repo",
                hostUrl: "http://127.0.0.1:14327",
                hostToken: "token-1",
              };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          }),
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
      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      );
      expect(handle.runtime).toMatchObject({
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: repo,
        role: "workspace",
        workingDirectory: repo,
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:43123",
        },
        startedAt: "2026-05-10T10:00:00.000Z",
      });
      expect(portProbeCalls).toEqual([43123, 43123, 43123]);
      await waitFor(() => existsSync(configCapturePath));
      expect(JSON.parse(await readFile(configCapturePath, "utf8"))).toEqual({
        logLevel: "INFO",
        mcp: {
          openducktor: {
            type: "local",
            enabled: true,
            command: [process.execPath],
            environment: {
              ODT_WORKSPACE_ID: "repo",
              ODT_HOST_URL: "http://127.0.0.1:14327",
              ODT_HOST_TOKEN: "token-1",
              ODT_FORBID_WORKSPACE_ID_INPUT: "true",
              ODT_ALLOWED_TOOLS: ODT_WORKFLOW_AGENT_TOOL_NAMES.join(","),
            },
          },
        },
      });
      await waitFor(() => existsSync(environmentCapturePath));
      expect(JSON.parse(await readFile(environmentCapturePath, "utf8"))).toEqual({
        password: null,
        username: null,
      });
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("registers the live adapter before forwarding and returning the runtime handle", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-live-order-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
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
        runAdapterMutation: (mutation) => Effect.map(mutation, (result) => result.value),
      };
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
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
        startupTimeoutMs: 2_000,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-live-order",
      });

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      );
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
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
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
        Effect.either(
          starter.startWorkspaceRuntime({
            runtimeKind: "opencode",
            repoPath: repo,
            workingDirectory: repo,
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
          }),
        ),
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
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        startupTimeoutMs: 40,
        retryDelayMs: 1,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.sleep("50 millis").pipe(Effect.as(false)),
      });

      const startedAt = Date.now();
      await expect(
        Effect.runPromise(
          starter.startWorkspaceRuntime({
            runtimeKind: "opencode",
            repoPath: repo,
            workingDirectory: repo,
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
          }),
        ),
      ).rejects.toThrow("Timed out waiting for OpenCode runtime on 127.0.0.1:43123.");

      expect(Date.now() - startedAt).toBeLessThan(500);
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("releases exactly its live runtime when the OpenCode process exits unexpectedly", async () => {
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
        runAdapterMutation: (mutation) => Effect.map(mutation, (result) => result.value),
      };
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
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

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      );
      await waitFor(() => releasedRuntimeIds.length === 1);
      expect(releasedRuntimeIds).toEqual(["runtime-unexpected-close"]);
      await Effect.runPromise(handle.stop());
      expect(releasedRuntimeIds).toEqual(["runtime-unexpected-close"]);
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("discards prepared observation when live-adapter registration fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-live-register-failure-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      let discardCalls = 0;
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        liveSessionLifecycle: {
          registerRuntimeAdapter: () =>
            Effect.fail(
              new HostOperationError({
                operation: "test.register-live-adapter",
                message: "live registration failed",
              }),
            ),
          releaseRuntime: () => Effect.succeed([]),
          runAdapterMutation: (mutation) => Effect.map(mutation, (result) => result.value),
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

      await expect(
        Effect.runPromise(
          starter.startWorkspaceRuntime({
            runtimeKind: "opencode",
            repoPath: repo,
            workingDirectory: repo,
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
          }),
        ),
      ).rejects.toThrow("live registration failed");
      expect(discardCalls).toBe(1);
    } finally {
      await removeTestDirectory(root);
    }
  });

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
        runAdapterMutation: (mutation) => Effect.map(mutation, (result) => result.value),
      };
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
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

      await expect(
        Effect.runPromise(
          starter.startWorkspaceRuntime({
            runtimeKind: "opencode",
            repoPath: repo,
            workingDirectory: repo,
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
          }),
        ),
      ).rejects.toThrow("live forwarding failed");
      expect(registeredRuntimeIds.size).toBe(0);
      expect(releasedRuntimeIds).toEqual(["runtime-forward-failure"]);
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("stops the OpenCode runtime process tree including descendants", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-starter-tree-"));
    let childPid: number | null = null;
    try {
      const repo = join(root, "repo");
      const childPidPath = join(root, "child.pid");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, { childPidPath });
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-tree",
      });

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      );
      await waitFor(() => existsSync(childPidPath));
      childPid = Number(await readFile(childPidPath, "utf8"));
      expect(processIsAlive(childPid)).toBe(true);

      await Effect.runPromise(handle.stop());
      await waitFor(() => !processIsAlive(childPid as number));
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
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root, { childPidPath });
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        startupTimeoutMs: 100,
        retryDelayMs: 5,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () =>
          Effect.promise(() => waitFor(() => existsSync(childPidPath))).pipe(Effect.as(false)),
      });

      await expect(
        Effect.runPromise(
          starter.startWorkspaceRuntime({
            runtimeKind: "opencode",
            repoPath: repo,
            workingDirectory: repo,
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
          }),
        ),
      ).rejects.toThrow("Timed out waiting for OpenCode runtime on 127.0.0.1:43123.");
      childPid = Number(await readFile(childPidPath, "utf8"));
      await waitFor(() => !processIsAlive(childPid as number));
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
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
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

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      );

      await expect(Effect.runPromise(handle.stop())).rejects.toThrow("process tree stayed alive");
    } finally {
      if (runtimePid !== null && processIsAlive(runtimePid)) {
        await Effect.runPromise(forceStopProcessTree(runtimePid));
      }
      await removeTestDirectory(root);
    }
  });

  test("includes startup timeout cleanup failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-timeout-cleanup-failure-"));
    let runtimePid: number | null = null;
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommands(),
        toolDiscovery: createFakeToolDiscovery({ opencode: opencodeBinary }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
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

      await expect(
        Effect.runPromise(
          starter.startWorkspaceRuntime({
            runtimeKind: "opencode",
            repoPath: repo,
            workingDirectory: repo,
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
          }),
        ),
      ).rejects.toThrow(
        "Timed out waiting for OpenCode runtime on 127.0.0.1:43123. Cleanup failed: process tree cleanup failed",
      );
    } finally {
      if (runtimePid !== null && processIsAlive(runtimePid)) {
        await Effect.runPromise(forceStopProcessTree(runtimePid));
      }
      await removeTestDirectory(root);
    }
  });

  test("starts a Windows PATH-discovered cmd OpenCode runtime", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "odt-opencode-path-starter-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const pathWithFakeRuntime = `${root};${process.env.PATH ?? ""}`;
      const starter = createOpenCodeWorkspaceRuntimeStarter({
        systemCommands: createSystemCommandRunner({
          env: { ...process.env, PATH: pathWithFakeRuntime, PATHEXT: ".CMD" },
          platform: "win32",
        }),
        processEnv: { ...process.env, PATH: pathWithFakeRuntime, PATHEXT: ".CMD" },
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        portAllocator: () => Effect.succeed(43123),
        readinessProbe: () => Effect.succeed(true),
        runtimeId: () => "runtime-path",
      });

      expect(opencodeBinary.endsWith(".cmd")).toBe(true);
      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "opencode",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
        }),
      );

      expect(handle.runtime.runtimeId).toBe("runtime-path");
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
    } finally {
      await removeTestDirectory(root);
    }
  });
});
