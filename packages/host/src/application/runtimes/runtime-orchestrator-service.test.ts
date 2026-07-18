import { Cause, Effect } from "effect";
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
  test("executes the runtime-ready logger Effect", async () => {
    const infos: string[] = [];
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      logger: {
        error: () => Effect.void,
        info: (message) => Effect.sync(() => infos.push(message)),
      },
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry(),
      taskReader: createTaskStore(),
    });

    await Effect.runPromise(service.runtimeEnsure({ runtimeKind: "opencode", repoPath: "/repo" }));

    expect(infos).toEqual([
      "opencode workspace runtime opencode-runtime-1 is ready at http://127.0.0.1:4096",
    ]);
  });

  test("executes the runtime-startup failure logger Effect", async () => {
    const errors: string[] = [];
    const startupFailure = new HostOperationError({
      operation: "test.runtime-startup",
      message: "runtime failed to start",
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      logger: {
        error: (message) => Effect.sync(() => errors.push(message)),
        info: () => Effect.void,
      },
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([], {
        ensureWorkspaceRuntime: () => Effect.fail(startupFailure),
      }),
      taskReader: createTaskStore(),
    });

    const exit = await Effect.runPromiseExit(
      service.runtimeEnsure({ runtimeKind: "opencode", repoPath: "/repo" }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Array.from(Cause.failures(exit.cause))[0]).toBe(startupFailure);
    }
    expect(errors).toEqual([
      "Failed to ensure opencode workspace runtime for repository /canonical/repo: runtime failed to start",
    ]);
  });

  test("executes repo runtime health logger Effects", async () => {
    const infos: string[] = [];
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      logger: {
        error: () => Effect.void,
        info: (message) => Effect.sync(() => infos.push(message)),
      },
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry(),
      taskReader: createTaskStore(),
    });

    await Effect.runPromise(
      service.repoRuntimeHealth({ runtimeKind: "opencode", repoPath: "/repo" }),
    );

    expect(infos).toEqual([
      "Checking opencode repo runtime health for repository /canonical/repo",
      "opencode workspace runtime opencode-runtime-1 is ready at http://127.0.0.1:4096",
      "opencode repo runtime health is ready for repository /canonical/repo",
    ]);
  });

  test("propagates repo runtime health logging failures", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      logger: {
        error: () => Effect.void,
        info: () => Effect.fail(persistenceError),
      },
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry(),
      taskReader: createTaskStore(),
    });

    const exit = await Effect.runPromiseExit(
      service.repoRuntimeHealth({ runtimeKind: "opencode", repoPath: "/repo" }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Array.from(Cause.failures(exit.cause))[0]).toMatchObject({
        _tag: "HostOperationError",
        operation: "runtime-orchestrator.log-info",
        cause: persistenceError,
      });
    }
  });

  test("propagates runtime-ready logging failures from repo runtime health", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    let infoCalls = 0;
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      logger: {
        error: () => Effect.void,
        info: () => {
          infoCalls += 1;
          return infoCalls === 2 ? Effect.fail(persistenceError) : Effect.void;
        },
      },
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry(),
      taskReader: createTaskStore(),
    });

    const exit = await Effect.runPromiseExit(
      service.repoRuntimeHealth({ runtimeKind: "opencode", repoPath: "/repo" }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Array.from(Cause.failures(exit.cause))[0]).toMatchObject({
        _tag: "HostOperationError",
        operation: "runtime-orchestrator.log-info",
        cause: persistenceError,
      });
    }
  });

  test("preserves runtime startup and logging failures together", async () => {
    const startupFailure = new HostOperationError({
      operation: "test.runtime-startup",
      message: "runtime failed to start",
    });
    const loggingFailure = new Error("openducktor.logs.append failed");
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      logger: {
        error: () => Effect.fail(loggingFailure),
        info: () => Effect.void,
      },
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([], {
        ensureWorkspaceRuntime: () => Effect.fail(startupFailure),
      }),
      taskReader: createTaskStore(),
    });

    const exit = await Effect.runPromiseExit(
      service.runtimeEnsure({ runtimeKind: "opencode", repoPath: "/repo" }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Array.from(Cause.failures(exit.cause))[0]).toMatchObject({
        _tag: "HostOperationError",
        operation: "runtime-orchestrator.ensure",
        details: {
          runtimeFailure: startupFailure,
          loggingFailure: expect.objectContaining({
            _tag: "HostOperationError",
            operation: "runtime-orchestrator.log-error",
            cause: loggingFailure,
          }),
        },
      });
    }
  });

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
  test("delegates workspace runtime reuse to the registry", async () => {
    const runtime = createRuntime();
    const ensureCalls: unknown[] = [];
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime], {
        ensureWorkspaceRuntime(input) {
          ensureCalls.push(input);
          return Effect.succeed(runtime);
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(service.runtimeEnsure({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).resolves.toEqual(runtime);
    expect(ensureCalls).toEqual([
      expect.objectContaining({
        runtimeKind: "opencode",
        repoPath: "/canonical/repo",
        workingDirectory: "/canonical/repo",
      }),
    ]);
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
  test("repo runtime health status does not start missing workspace runtimes", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([], {
        ensureWorkspaceRuntime() {
          return Effect.dieMessage("status-only runtime health must not start runtimes");
        },
      }),
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
      },
      mcp: {
        status: "waiting_for_runtime",
      },
    });
  });
  test("repo runtime health status reports in-flight runtime ensure", async () => {
    const runtime = createRuntime();
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([], {
        ensureWorkspaceRuntime() {
          return Effect.promise(
            () =>
              new Promise((resolve) => {
                setTimeout(() => resolve(runtime), 20);
              }),
          );
        },
      }),
      taskReader: createTaskStore(),
    });

    const ensurePromise = Effect.runPromise(
      service.runtimeEnsure({ runtimeKind: "opencode", repoPath: "/repo" }),
    );

    await expect(
      Effect.runPromise(
        service.repoRuntimeHealthStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
      ),
    ).resolves.toMatchObject({
      runtime: {
        stage: "waiting_for_runtime",
        status: "checking",
      },
    });
    await expect(ensurePromise).resolves.toEqual(runtime);
    await expect(
      Effect.runPromise(
        service.repoRuntimeHealthStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
      ),
    ).resolves.toMatchObject({
      runtime: {
        stage: "idle",
        status: "not_started",
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
      activeMcpProbeRetryDelayMs: 0,
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
  test("active runtime health retries timeout MCP probes before publishing readiness", async () => {
    const probeCalls: unknown[] = [];
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([], {
        probeMcpStatus(input) {
          probeCalls.push(input);
          if (probeCalls.length === 1) {
            return Effect.succeed({
              supported: true,
              connected: false,
              serverStatus: null,
              toolIds: [],
              detail: "The operation was aborted due to timeout",
              failureKind: "timeout",
            });
          }
          return Effect.succeed({
            supported: true,
            connected: true,
            serverStatus: "connected",
            toolIds: ["odt_read_task"],
            detail: null,
            failureKind: null,
          });
        },
      }),
      taskReader: createTaskStore(),
      activeMcpProbeRetryDelayMs: 0,
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
  test("keeps exhausted MCP timeout probes pending for a ready workspace runtime", async () => {
    const runtime = createRuntime();
    let probeCalls = 0;
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime], {
        probeMcpStatus() {
          probeCalls += 1;
          return Effect.succeed({
            supported: true,
            connected: false,
            serverStatus: null,
            toolIds: [],
            detail: "The operation was aborted due to timeout",
            failureKind: "timeout",
          });
        },
      }),
      taskReader: createTaskStore(),
      activeMcpProbeRetryDelayMs: 0,
    });

    await expect(
      Effect.runPromise(service.repoRuntimeHealth({ runtimeKind: "opencode", repoPath: "/repo" })),
    ).resolves.toMatchObject({
      status: "checking",
      runtime: {
        status: "ready",
        stage: "runtime_ready",
      },
      mcp: {
        supported: true,
        status: "reconnecting",
        detail: "The operation was aborted due to timeout",
        failureKind: "timeout",
      },
    });
    expect(probeCalls).toBe(20);
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
  test("stops runtimes by id without loading runtime metadata", async () => {
    const runtime = createRuntime();
    const stopCalls: string[] = [];
    const registry = createRegistry([runtime], {
      findRuntimeById() {
        return Effect.dieMessage("runtimeStop should not load runtime metadata");
      },
      stopRuntime(runtimeId) {
        stopCalls.push(runtimeId);
        return Effect.succeed(true);
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
    expect(stopCalls).toEqual([runtime.runtimeId]);
  });
});
