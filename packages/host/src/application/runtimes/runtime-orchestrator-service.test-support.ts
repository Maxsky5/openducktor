import {
  type AgentSessionRecord,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { HostOperationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createRuntimeOrchestratorService as createEffectRuntimeOrchestratorService } from "./runtime-orchestrator-service";

export const createRuntimeOrchestratorService = (
  input: Parameters<typeof createEffectRuntimeOrchestratorService>[0],
) => createEffectRuntimeOrchestratorService(input);

export const createGitPort = (
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

export const createRuntimeDefinitionsService = () => ({
  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return Object.values(RUNTIME_DESCRIPTORS_BY_KIND);
  },
});

export const createTaskStore = (
  sessionOverrides: Partial<{
    externalSessionId: string;
    role: "build";
    startedAt: string;
    runtimeKind: "opencode" | "codex";
    workingDirectory: string;
    selectedModel: null;
  }> = {},
  extraAgentSessions: AgentSessionRecord[] = [],
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
            agentSessions: [session, ...extraAgentSessions],
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

export const createRuntime = (
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

export const createRegistry = (
  runtimes: RuntimeInstanceSummary[] = [],
  overrides: Partial<RuntimeRegistryPort> = {},
): RuntimeRegistryPort => {
  const runtimeStore = [...runtimes];
  const matchesRepo = (runtime: RuntimeInstanceSummary, repoPath: string): boolean =>
    normalizePathForComparison(runtime.repoPath) === normalizePathForComparison(repoPath);
  const findWorkspaceRuntime = (input: { repoPath: string; runtimeKind: string }) => {
    const matches = runtimeStore.filter(
      (runtime) =>
        runtime.role === "workspace" &&
        runtime.taskId === null &&
        runtime.kind === input.runtimeKind &&
        matchesRepo(runtime, input.repoPath),
    );
    if (matches.length > 1) {
      return Effect.fail(
        new HostOperationError({
          operation: "test.runtimeRegistry.findWorkspaceRuntime",
          message: `Multiple live ${input.runtimeKind} workspace runtimes found for repo '${input.repoPath}'.`,
        }),
      );
    }
    return Effect.succeed(matches[0] ?? null);
  };
  const upsertRuntime = (runtime: RuntimeInstanceSummary): void => {
    const existingIndex = runtimeStore.findIndex(
      (current) => current.runtimeId === runtime.runtimeId,
    );
    if (existingIndex === -1) {
      runtimeStore.push(runtime);
      return;
    }
    runtimeStore[existingIndex] = runtime;
  };

  return {
    ensureWorkspaceRuntime(input) {
      return Effect.gen(function* () {
        const existingRuntime = yield* findWorkspaceRuntime(input);
        if (existingRuntime) {
          return existingRuntime;
        }

        const runtime = createRuntime({
          kind: input.runtimeKind as RuntimeInstanceSummary["kind"],
          runtimeId: `${input.runtimeKind}-runtime-${runtimeStore.length + 1}`,
          repoPath: input.repoPath,
          workingDirectory: input.workingDirectory,
          descriptor: input.descriptor,
        });
        upsertRuntime(runtime);
        return runtime;
      });
    },
    findRuntimeById(runtimeId) {
      return Effect.succeed(
        runtimeStore.find((runtime) => runtime.runtimeId === runtimeId) ?? null,
      );
    },
    findWorkspaceRuntime,
    listRuntimes() {
      return Effect.succeed([...runtimeStore]);
    },
    listRuntimesByRepo(input) {
      return Effect.succeed(
        runtimeStore.filter(
          (runtime) =>
            matchesRepo(runtime, input.repoPath) &&
            (!input.runtimeKind || runtime.kind === input.runtimeKind),
        ),
      );
    },
    stopRuntime(runtimeId) {
      const runtimeIndex = runtimeStore.findIndex((runtime) => runtime.runtimeId === runtimeId);
      if (runtimeIndex === -1) {
        return Effect.succeed(false);
      }
      runtimeStore.splice(runtimeIndex, 1);
      return Effect.succeed(true);
    },
    stopAllRuntimes() {
      const stoppedRuntimes = [...runtimeStore];
      runtimeStore.length = 0;
      return Effect.succeed(stoppedRuntimes);
    },
    stopSession() {
      return Effect.succeed(undefined);
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
};
