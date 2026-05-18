import {
  type AgentSessionRecord,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import { createRuntimeTaskActivityGuard as createEffectRuntimeTaskActivityGuard } from "./runtime-task-activity-guard";

const createRuntimeTaskActivityGuard = (
  ...args: Parameters<typeof createEffectRuntimeTaskActivityGuard>
) => createEffectRuntimeTaskActivityGuard(...args);
const runtime = (overrides: Partial<RuntimeInstanceSummary> = {}): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
  startedAt: "2026-05-10T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
  ...overrides,
});
const registry = ({
  runtimes = [runtime()],
  liveSessions = new Set<string>(),
  supported = true,
}: {
  runtimes?: RuntimeInstanceSummary[];
  liveSessions?: Set<string>;
  supported?: boolean;
} = {}): RuntimeRegistryPort => ({
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
    return Effect.succeed(runtimes);
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
  stopAllRuntimes() {
    return Effect.succeed([]);
  },
  stopSession() {
    return Effect.tryPromise({
      try: async () => {
        throw new Error("unexpected session stop");
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    });
  },
  probeSessionStatus(input) {
    return Effect.tryPromise({
      try: async () => {
        return {
          supported,
          hasLiveSession: liveSessions.has(input.externalSessionId),
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
});
const session = (overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  externalSessionId: "external-build-session",
  role: "build" as const,
  startedAt: "2026-05-10T10:00:00.000Z",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
  selectedModel: null,
  ...overrides,
});
describe("createRuntimeTaskActivityGuard", () => {
  test("blocks implementation reset when a runtime probe finds a live session", async () => {
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ liveSessions: new Set(["external-build-session"]) }),
    });
    await expect(
      Effect.runPromise(
        guard.ensureNoActiveTaskResetActivity({
          repoPath: "/repo",
          taskId: "task-1",
          sessions: [session()],
          operationLabel: "reset implementation",
          sessionRoles: ["build", "qa"],
        }),
      ),
    ).rejects.toThrow(
      "Cannot reset implementation while active build session(s) exist for task task-1. Stop the active session(s) first.",
    );
  });
  test("allows task reset when the matching runtime reports no live session", async () => {
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry(),
    });
    await expect(
      Effect.runPromise(
        guard.ensureNoActiveTaskResetActivity({
          repoPath: "/repo",
          taskId: "task-1",
          sessions: [session()],
          operationLabel: "reset task",
          sessionRoles: ["spec", "planner", "build", "qa"],
        }),
      ),
    ).resolves.toBeUndefined();
  });
  test("blocks delete with QA-specific wording when only QA sessions are active", async () => {
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ liveSessions: new Set(["external-qa-session"]) }),
    });
    await expect(
      Effect.runPromise(
        guard.ensureNoActiveTaskDeleteRuns({
          repoPath: "/repo",
          taskIds: ["task-1"],
          tasks: [
            {
              id: "task-1",
              title: "Task 1",
              description: "",
              notes: "",
              status: "ai_review",
              priority: 2,
              issueType: "task",
              aiReviewEnabled: true,
              availableActions: [],
              labels: [],
              subtaskIds: [],
              documentSummary: {
                spec: { has: false },
                plan: { has: false },
                qaReport: { has: false, verdict: "not_reviewed" },
              },
              agentWorkflows: {
                spec: { required: false, canSkip: true, available: false, completed: false },
                planner: { required: false, canSkip: true, available: false, completed: false },
                builder: { required: true, canSkip: false, available: false, completed: false },
                qa: { required: true, canSkip: false, available: false, completed: false },
              },
              agentSessions: [
                session({
                  externalSessionId: "external-qa-session",
                  role: "qa",
                }),
              ],
              updatedAt: "2026-05-10T10:00:00.000Z",
              createdAt: "2026-05-10T09:00:00.000Z",
            },
          ],
        }),
      ),
    ).rejects.toThrow(
      "Cannot delete tasks with active QA work in progress. Stop the active QA session(s) first: task-1 (qa session)",
    );
  });
  test("treats unsupported runtime probes as active before destructive cleanup", async () => {
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ supported: false }),
    });
    await expect(
      Effect.runPromise(
        guard.ensureNoActiveTaskResetActivity({
          repoPath: "/repo",
          taskId: "task-1",
          sessions: [session()],
          operationLabel: "reset implementation",
          sessionRoles: ["build"],
        }),
      ),
    ).rejects.toThrow(
      "Cannot reset implementation while active build session(s) exist for task task-1. Stop the active session(s) first.",
    );
  });
});
