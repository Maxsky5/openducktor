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
    findRuntimeById(runtimeId) {
      return Effect.succeed(entries.get(runtimeId) ?? null);
    },
    listRuntimes() {
      return Effect.succeed([...entries.values()]);
    },
    listRuntimesByRepo(input) {
      const normalizedInput = normalizePathForComparison(input.repoPath);
      return Effect.succeed(
        [...entries.values()].filter(
          (runtime) =>
            normalizePathForComparison(runtime.repoPath) === normalizedInput &&
            (!input.runtimeKind || runtime.kind === input.runtimeKind),
        ),
      );
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
