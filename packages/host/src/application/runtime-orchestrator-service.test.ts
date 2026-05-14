import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import type { GitPort } from "../ports/git-port";
import type { RuntimeRegistryPort } from "../ports/runtime-registry-port";
import type { TaskStorePort } from "../ports/task-store-port";
import { createRuntimeOrchestratorService } from "./runtime-orchestrator-service";

const createGitPort = (): GitPort =>
  ({
    async canonicalizePath(path: string) {
      return path === "/repo" ? "/canonical/repo" : path;
    },
    async isGitRepository(path: string) {
      return path === "/canonical/repo";
    },
  }) as GitPort;

const createRuntimeDefinitionsService = () => ({
  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return Object.values(RUNTIME_DESCRIPTORS_BY_KIND);
  },
});

const createTaskStore = (): TaskStorePort =>
  ({
    async getTaskMetadata() {
      return {
        spec: undefined,
        plan: undefined,
        qaReport: undefined,
        pullRequest: undefined,
        directMerge: undefined,
        agentSessions: [
          {
            externalSessionId: "external-session-1",
            role: "build",
            startedAt: "2026-05-10T10:00:00.000Z",
            runtimeKind: "opencode",
            workingDirectory: "/canonical/repo/worktree",
            selectedModel: null,
          },
        ],
      };
    },
  }) as TaskStorePort;

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
  return {
    async ensureWorkspaceRuntime(input) {
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
    async listRuntimes() {
      return [...entries.values()];
    },
    async stopRuntime(runtimeId) {
      if (!entries.delete(runtimeId)) {
        throw new Error(`Runtime not found: ${runtimeId}`);
      }
      return true;
    },
    async stopSession() {},
    ...overrides,
  };
};

describe("createRuntimeOrchestratorService", () => {
  test("ensures a workspace runtime for the canonical repository path", async () => {
    const registry = createRegistry();
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskStore: createTaskStore(),
    });

    await expect(
      service.runtimeEnsure({ runtimeKind: "opencode", repoPath: "/repo" }),
    ).resolves.toMatchObject({
      kind: "opencode",
      repoPath: "/canonical/repo",
      role: "workspace",
      workingDirectory: "/canonical/repo",
    });
    await expect(
      service.runtimeStartupStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
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
      taskStore: createTaskStore(),
    });

    await expect(
      service.runtimeList({ runtimeKind: "opencode", repoPath: "/repo" }),
    ).resolves.toEqual([runtime]);
  });

  test("reports ready startup status for a registered workspace runtime", async () => {
    const runtime = createRuntime();
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([runtime]),
      taskStore: createTaskStore(),
    });

    await expect(
      service.runtimeStartupStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
    ).resolves.toMatchObject({
      runtimeKind: "opencode",
      repoPath: "/canonical/repo",
      stage: "runtime_ready",
      runtime,
      startedAt: runtime.startedAt,
    });
  });

  test("reports not started runtime health status when no runtime is registered", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry(),
      taskStore: createTaskStore(),
    });

    await expect(
      service.repoRuntimeHealthStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
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

  test("active runtime health ensures a workspace runtime before probing MCP", async () => {
    const probeCalls: unknown[] = [];
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([], {
        async probeMcpStatus(input) {
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
      }),
      taskStore: createTaskStore(),
    });

    await expect(
      service.repoRuntimeHealth({ runtimeKind: "opencode", repoPath: "/repo" }),
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
        async probeMcpStatus(input) {
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
      }),
      taskStore: createTaskStore(),
      activeMcpProbeRetryDelayMs: 1,
    });

    await expect(
      service.repoRuntimeHealth({ runtimeKind: "opencode", repoPath: "/repo" }),
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
        async probeMcpStatus(input) {
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
      }),
      taskStore: createTaskStore(),
    });

    await expect(
      service.repoRuntimeHealthStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
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
        async probeMcpStatus() {
          throw new Error("OpenCode load MCP status failed");
        },
      }),
      taskStore: createTaskStore(),
    });

    await expect(
      service.repoRuntimeHealthStatus({ runtimeKind: "opencode", repoPath: "/repo" }),
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
      taskStore: createTaskStore(),
    });

    await expect(service.runtimeStop({ runtimeId: runtime.runtimeId })).resolves.toEqual({
      ok: true,
    });
    await expect(service.runtimeList({ runtimeKind: "opencode" })).resolves.toEqual([]);
  });

  test("stops persisted agent sessions through the matching runtime route", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime({ workingDirectory: "/canonical/repo/worktree" });
    const registry: RuntimeRegistryPort = {
      async ensureWorkspaceRuntime() {
        throw new Error("unexpected runtime ensure");
      },
      async listRuntimes() {
        return [runtime];
      },
      async stopRuntime() {
        throw new Error("unexpected runtime stop");
      },
      async stopSession(input) {
        calls.push(input);
      },
    };
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskStore: createTaskStore(),
    });

    await expect(
      service.agentSessionStop({
        request: {
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/worktree",
        },
      }),
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

  test("rejects agent session stop when persisted session identity mismatches the request", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([createRuntime()]),
      taskStore: createTaskStore(),
    });

    await expect(
      service.agentSessionStop({
        request: {
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "codex",
          workingDirectory: "/canonical/repo/worktree",
        },
      }),
    ).rejects.toThrow(
      "Agent session with externalSessionId external-session-1 runtime kind mismatch",
    );
  });
});
