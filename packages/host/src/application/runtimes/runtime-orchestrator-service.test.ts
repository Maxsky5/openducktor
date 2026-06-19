import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  createGitPort,
  createRegistry,
  createRuntime,
  createRuntimeDefinitionsService,
  createRuntimeOrchestratorService,
  createTaskStore,
} from "./runtime-orchestrator-service.test-support";

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
  });
  test("returns an existing workspace runtime without entering startup", async () => {
    const runtime = createRuntime();
    const ensureCalls: unknown[] = [];
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime], {
        ensureWorkspaceRuntime(input) {
          ensureCalls.push(input);
          return Effect.dieMessage("existing runtime should not enter startup");
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.runtimeEnsure({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).resolves.toEqual(runtime);
    expect(ensureCalls).toEqual([]);
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
  test("requires a live workspace runtime by kind and canonical repository", async () => {
    const runtime = createRuntime();
    const workspaceLookups: unknown[] = [];
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime], {
        listRuntimesByRepo() {
          return Effect.dieMessage("unexpected repo runtime list");
        },
        findWorkspaceRuntime(input) {
          workspaceLookups.push(input);
          return Effect.succeed(runtime);
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.runtimeRequire({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).resolves.toEqual(runtime);
    expect(workspaceLookups).toEqual([{ repoPath: "/canonical/repo", runtimeKind: "opencode" }]);
  });
  test("fails when requiring a missing workspace runtime", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([]),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.runtimeRequire({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).rejects.toThrow("No live repo runtime found for repo '/canonical/repo', runtime 'opencode'.");
  });
  test("uses keyed repository lookup for repo-scoped runtime lists", async () => {
    const runtime = createRuntime();
    const keyedLookups: unknown[] = [];
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime], {
        listRuntimes() {
          return Effect.dieMessage("unexpected full runtime list");
        },
        listRuntimesByRepo(input) {
          keyedLookups.push(input);
          return Effect.succeed([runtime]);
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.runtimeList({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).resolves.toEqual([runtime]);
    expect(keyedLookups).toEqual([{ repoPath: "/canonical/repo", runtimeKind: "opencode" }]);
  });
  test("keeps runtimes returned by normalized repository lookup", async () => {
    const runtime = createRuntime({ repoPath: "/canonical/repo/." });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime]),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.runtimeList({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).resolves.toEqual([runtime]);
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
      Effect.runPromise(service.repoRuntimeHealth({ runtimeKind: "opencode", repoPath: "/repo" })),
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
      Effect.runPromise(service.repoRuntimeHealth({ runtimeKind: "opencode", repoPath: "/repo" })),
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
  test("uses runtime id lookup before stopping a registered runtime", async () => {
    const runtime = createRuntime();
    const idLookups: string[] = [];
    const registry = createRegistry([runtime], {
      findRuntimeById(runtimeId) {
        idLookups.push(runtimeId);
        return Effect.succeed(runtime);
      },
      listRuntimes() {
        return Effect.dieMessage("unexpected full runtime list");
      },
    });
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
    expect(idLookups).toEqual([runtime.runtimeId]);
  });
});
