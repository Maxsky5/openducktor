import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createRuntimeOrchestratorService as createEffectRuntimeOrchestratorService } from "./runtime-orchestrator-service";

const createRuntimeOrchestratorService = (
  input: Parameters<typeof createEffectRuntimeOrchestratorService>[0],
) => createEffectRuntimeOrchestratorService(input);
const createGitPort = (
  canonicalizePath: (path: string) => string = (path) =>
    path === "/repo" ? "/canonical/repo" : path,
  isGitRepository: (path: string) => boolean = (path) => path === "/canonical/repo",
): GitPort =>
  ({
    canonicalizePath(path: string) {
      return Effect.tryPromise({
        try: async () => {
          return canonicalizePath(path);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    isGitRepository(path: string) {
      return Effect.tryPromise({
        try: async () => {
          return isGitRepository(path);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  }) as Pick<GitPort, "canonicalizePath" | "isGitRepository"> as unknown as GitPort;
const createRuntimeDefinitionsService = () => ({
  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return Object.values(RUNTIME_DESCRIPTORS_BY_KIND);
  },
});
const createTaskStore = (
  sessionOverrides: Partial<{
    externalSessionId: string;
    role: "build";
    startedAt: string;
    runtimeKind: "opencode" | "codex";
    workingDirectory: string;
    selectedModel: null;
  }> = {},
): TaskStorePort =>
  ({
    getTaskMetadata() {
      return Effect.tryPromise({
        try: async () => {
          const session = {
            externalSessionId: "external-session-1",
            role: "build" as const,
            startedAt: "2026-05-10T10:00:00.000Z",
            runtimeKind: "opencode" as const,
            workingDirectory: "/canonical/repo/worktree",
            selectedModel: null,
            ...sessionOverrides,
          };
          return {
            spec: { markdown: "" },
            plan: { markdown: "" },
            agentSessions: [session],
          };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  }) as Pick<TaskStorePort, "getTaskMetadata"> as unknown as TaskStorePort;
const createRuntime = (
  overrides: Partial<RuntimeInstanceSummary> = {},
): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/canonical/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/canonical/repo",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4096",
  },
  startedAt: "2026-05-10T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
  ...overrides,
});
const createRegistry = (
  runtimes: RuntimeInstanceSummary[] = [],
  overrides: Partial<RuntimeRegistryPort> = {},
): RuntimeRegistryPort => {
  const entries = new Map(runtimes.map((runtime) => [runtime.runtimeId, runtime]));
  const registry: RuntimeRegistryPort = {
    ensureWorkspaceRuntime(input) {
      return Effect.tryPromise({
        try: async () => {
          const existing = [...entries.values()].find(
            (runtime) =>
              runtime.kind === input.runtimeKind &&
              runtime.repoPath === input.repoPath &&
              runtime.role === "workspace",
          );
          if (existing) {
            return existing;
          }
          const runtime = createRuntime({
            kind: input.runtimeKind as RuntimeInstanceSummary["kind"],
            repoPath: input.repoPath,
            workingDirectory: input.workingDirectory,
            descriptor: input.descriptor,
          });
          entries.set(runtime.runtimeId, runtime);
          return runtime;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    listRuntimes() {
      return Effect.succeed([...entries.values()]);
    },
    stopRuntime(runtimeId) {
      return Effect.tryPromise({
        try: async () => {
          if (!entries.delete(runtimeId)) {
            throw new Error(`Runtime not found: ${runtimeId}`);
          }
          return true;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    stopAllRuntimes() {
      return Effect.sync(() => {
        const stopped = [...entries.values()];
        entries.clear();
        return stopped;
      });
    },
    stopSession() {
      return Effect.tryPromise({
        try: async () => {},
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    probeSessionStatus() {
      return Effect.succeed({ supported: false, hasLiveSession: false });
    },
    probeMcpStatus() {
      return Effect.succeed({
        supported: false,
        connected: false,
        serverStatus: null,
        toolIds: [],
        detail: null,
        failureKind: null,
      });
    },
    ...overrides,
  };
  return registry as unknown as RuntimeRegistryPort;
};
describe("createRuntimeOrchestratorService", () => {
  test("ensures a workspace runtime for the canonical repository path", async () => {
    const registry = createRegistry();
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.runtimeEnsure({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).resolves.toMatchObject({
      kind: "opencode",
      repoPath: "/canonical/repo",
      role: "workspace",
      workingDirectory: "/canonical/repo",
    });
    await expect(
      Effect.runPromise(
        service.runtimeStartupStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
      ),
    ).resolves.toMatchObject({
      stage: "runtime_ready",
      runtime: expect.objectContaining({ repoPath: "/canonical/repo" }),
    });
  });
  test("lists registered runtimes by kind and canonical repository", async () => {
    const runtime = createRuntime();
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime, createRuntime({ kind: "codex", runtimeId: "2" })]),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.runtimeList({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).resolves.toEqual([runtime]);
  });
  test("reports ready startup status for a registered workspace runtime", async () => {
    const runtime = createRuntime();
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime]),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.runtimeStartupStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
      ),
    ).resolves.toMatchObject({
      runtimeKind: "opencode",
      repoPath: "/canonical/repo",
      stage: "runtime_ready",
      runtime,
      startedAt: runtime.startedAt,
    });
  });
  test("reports waiting startup status while runtime ensure is in flight", async () => {
    let resolveEnsure: (runtime: RuntimeInstanceSummary) => void = () => {};
    const ensureStarted = new Promise<RuntimeInstanceSummary>((resolve) => {
      resolveEnsure = resolve;
    });
    const registry = createRegistry([], {
      ensureWorkspaceRuntime() {
        return Effect.tryPromise({
          try: async () => {
            return ensureStarted;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore(),
    });
    const ensure = Effect.runPromise(
      service.runtimeEnsure({ runtimeKind: "opencode", repoPath: "/repo" }),
    );
    await expect(
      Effect.runPromise(
        service.runtimeStartupStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
      ),
    ).resolves.toMatchObject({
      runtimeKind: "opencode",
      repoPath: "/canonical/repo",
      stage: "waiting_for_runtime",
      runtime: null,
      attempts: 0,
    });
    resolveEnsure(createRuntime());
    await expect(ensure).resolves.toMatchObject({ runtimeId: "runtime-1" });
  });
  test("matches startup status keys by normalized canonical repository path", async () => {
    let resolveEnsure: (runtime: RuntimeInstanceSummary) => void = () => {};
    const ensureStarted = new Promise<RuntimeInstanceSummary>((resolve) => {
      resolveEnsure = resolve;
    });
    const registry = createRegistry([], {
      ensureWorkspaceRuntime() {
        return Effect.tryPromise({
          try: async () => {
            return ensureStarted;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(
        (path) => path,
        (path) => path === "C:\\Repo" || path === "c:/repo",
      ),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore(),
    });
    const ensure = Effect.runPromise(
      service.runtimeEnsure({ runtimeKind: "opencode", repoPath: "C:\\Repo" }),
    );
    await expect(
      Effect.runPromise(
        service.runtimeStartupStatus({ runtimeKind: "opencode", repoPath: "c:/repo" }),
      ),
    ).resolves.toMatchObject({
      runtimeKind: "opencode",
      repoPath: "C:\\Repo",
      stage: "waiting_for_runtime",
      runtime: null,
      attempts: 0,
    });
    resolveEnsure(createRuntime({ repoPath: "C:\\Repo", workingDirectory: "C:\\Repo" }));
    await expect(ensure).resolves.toMatchObject({ repoPath: "C:\\Repo" });
  });
  test("records startup failure status when runtime ensure fails", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([], {
        ensureWorkspaceRuntime() {
          return Effect.tryPromise({
            try: async () => {
              throw new Error("Codex app-server failed to initialize");
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.runtimeEnsure({ runtimeKind: "codex", repoPath: "/repo" })),
    ).rejects.toThrow("Codex app-server failed to initialize");
    await expect(
      Effect.runPromise(service.runtimeStartupStatus({ runtimeKind: "codex", repoPath: "/repo" })),
    ).resolves.toMatchObject({
      runtimeKind: "codex",
      repoPath: "/canonical/repo",
      stage: "startup_failed",
      runtime: null,
      failureKind: "error",
      failureReason: "error",
      detail: "Codex app-server failed to initialize",
    });
  });
  test("reports not started runtime health status when no runtime is registered", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry(),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.repoRuntimeHealthStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
      ),
    ).resolves.toMatchObject({
      status: "not_started",
      runtime: {
        status: "not_started",
        stage: "idle",
        instance: null,
        detail: "Runtime has not been started yet.",
      },
      mcp: {
        supported: true,
        status: "waiting_for_runtime",
        serverName: "openducktor",
      },
    });
  });
  test("repo runtime health reports startup failure instead of dropping the status", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([], {
        ensureWorkspaceRuntime() {
          return Effect.tryPromise({
            try: async () => {
              throw new Error("Codex app-server failed to initialize");
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.repoRuntimeHealth({ runtimeKind: "codex", repoPath: "/repo" })),
    ).resolves.toMatchObject({
      status: "error",
      runtime: {
        status: "error",
        stage: "startup_failed",
        detail: "Codex app-server failed to initialize",
        failureKind: "error",
        failureReason: "error",
      },
      mcp: {
        status: "waiting_for_runtime",
      },
    });
  });
  test("active runtime health ensures a workspace runtime before probing MCP", async () => {
    const probeCalls: unknown[] = [];
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([], {
        probeMcpStatus(input) {
          return Effect.tryPromise({
            try: async () => {
              probeCalls.push(input);
              return {
                supported: true,
                connected: true,
                serverStatus: "connected",
                toolIds: ["odt_read_task"],
                detail: null,
                failureKind: null,
              };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.repoRuntimeHealth({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).resolves.toMatchObject({
      status: "ready",
      runtime: {
        status: "ready",
        stage: "runtime_ready",
        instance: {
          repoPath: "/canonical/repo",
          role: "workspace",
          workingDirectory: "/canonical/repo",
        },
      },
      mcp: {
        supported: true,
        status: "connected",
        toolIds: ["odt_read_task"],
      },
    });
    expect(probeCalls).toHaveLength(1);
  });
  test("active runtime health waits for OpenCode MCP readiness after startup", async () => {
    const probeCalls: unknown[] = [];
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([], {
        probeMcpStatus(input) {
          return Effect.tryPromise({
            try: async () => {
              probeCalls.push(input);
              if (probeCalls.length === 1) {
                return {
                  supported: true,
                  connected: false,
                  serverStatus: null,
                  toolIds: [],
                  detail: "Failed to load MCP status",
                  failureKind: "error",
                };
              }
              return {
                supported: true,
                connected: true,
                serverStatus: "connected",
                toolIds: ["odt_read_task"],
                detail: null,
                failureKind: null,
              };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      taskReader: createTaskStore(),
      activeMcpProbeRetryDelayMs: 1,
    });
    await expect(
      Effect.runPromise(service.repoRuntimeHealth({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).resolves.toMatchObject({
      status: "ready",
      mcp: {
        supported: true,
        status: "connected",
        toolIds: ["odt_read_task"],
      },
    });
    expect(probeCalls).toHaveLength(2);
  });
  test("reports active MCP health for a ready workspace runtime", async () => {
    const runtime = createRuntime();
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime], {
        probeMcpStatus(input) {
          return Effect.tryPromise({
            try: async () => {
              expect(input).toMatchObject({
                runtimeKind: "opencode",
                runtimeRoute: runtime.runtimeRoute,
                workingDirectory: "/canonical/repo",
                serverName: "openducktor",
              });
              return {
                supported: true,
                connected: true,
                serverStatus: "connected",
                toolIds: ["odt_read_task", "odt_set_spec"],
                detail: null,
                failureKind: null,
              };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.repoRuntimeHealthStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
      ),
    ).resolves.toMatchObject({
      status: "ready",
      runtime: {
        status: "ready",
        stage: "runtime_ready",
        instance: runtime,
      },
      mcp: {
        supported: true,
        status: "connected",
        serverName: "openducktor",
        serverStatus: "connected",
        toolIds: ["odt_read_task", "odt_set_spec"],
      },
    });
  });
  test("reports MCP probe failures as runtime health errors", async () => {
    const runtime = createRuntime();
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime], {
        probeMcpStatus() {
          return Effect.tryPromise({
            try: async () => {
              throw new Error("OpenCode load MCP status failed");
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.repoRuntimeHealthStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
      ),
    ).resolves.toMatchObject({
      status: "error",
      runtime: {
        status: "ready",
        stage: "runtime_ready",
      },
      mcp: {
        supported: true,
        status: "error",
        detail: "OpenCode load MCP status failed",
        failureKind: "error",
      },
    });
  });
  test("stops registered runtimes", async () => {
    const runtime = createRuntime();
    const registry = createRegistry([runtime]);
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.runtimeStop({ runtimeId: runtime.runtimeId })),
    ).resolves.toEqual({
      ok: true,
    });
    await expect(
      Effect.runPromise(service.runtimeList({ runtimeKind: "opencode" })),
    ).resolves.toEqual([]);
  });
  test("stops persisted agent sessions through the matching runtime route", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime({ workingDirectory: "/canonical/repo/worktree" });
    const registry = createRegistry([], {
      ensureWorkspaceRuntime() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected runtime ensure");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listRuntimes() {
        return Effect.succeed([runtime]);
      },
      stopRuntime() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected runtime stop");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      stopSession(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        runtimeKind: "opencode",
        runtimeRoute: runtime.runtimeRoute,
        externalSessionId: "external-session-1",
        workingDirectory: "/canonical/repo/worktree",
      },
    ]);
  });
  test("stops persisted Codex sessions through the resolved stdio runtime route", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime({
      kind: "codex",
      runtimeId: "runtime-codex-1",
      workingDirectory: "/canonical/repo/worktree",
      runtimeRoute: { type: "stdio", identity: "runtime-codex-1" },
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
    });
    const registry = createRegistry([], {
      ensureWorkspaceRuntime() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.effect",
            message: "unexpected runtime ensure",
          }),
        );
      },
      listRuntimes() {
        return Effect.succeed([runtime]);
      },
      stopSession(input) {
        return Effect.sync(() => {
          calls.push(input);
        });
      },
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore({ runtimeKind: "codex" }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "codex",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        runtimeKind: "codex",
        runtimeRoute: { type: "stdio", identity: "runtime-codex-1" },
        externalSessionId: "external-session-1",
        workingDirectory: "/canonical/repo/worktree",
      },
    ]);
  });
  test("rejects agent session stop when persisted session identity mismatches the request", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([createRuntime()]),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "codex",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).rejects.toThrow(
      "Agent session with externalSessionId external-session-1 runtime kind mismatch",
    );
  });
});
