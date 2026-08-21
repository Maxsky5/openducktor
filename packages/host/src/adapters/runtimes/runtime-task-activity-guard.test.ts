import type { AgentSessionRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import { createRuntimeTaskActivityGuard as createEffectRuntimeTaskActivityGuard } from "./runtime-task-activity-guard";

const createRuntimeTaskActivityGuard = (
  ...args: Parameters<typeof createEffectRuntimeTaskActivityGuard>
) => createEffectRuntimeTaskActivityGuard(...args);
const registry = ({
  liveSessions = new Set<string>(),
  probeCalls = [],
  stopCalls = [],
  probeSupported = true,
  stopError = null,
}: {
  liveSessions?: Set<string>;
  probeCalls?: unknown[];
  stopCalls?: string[];
  probeSupported?: boolean;
  stopError?: string | null;
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
    return Effect.succeed([]);
  },
  findRuntimeById() {
    return Effect.succeed(null);
  },
  findWorkspaceRuntime() {
    return Effect.succeed(null);
  },
  listRuntimesByRepo() {
    return Effect.succeed([]);
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
  stopSession(input) {
    return Effect.tryPromise({
      try: async () => {
        if (stopError) {
          throw new Error(stopError);
        }
        stopCalls.push(input.externalSessionId);
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
        probeCalls.push(input);
        return {
          supported: probeSupported,
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
  test("stops a live session before implementation reset and reports the stopped count", async () => {
    const stopCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({
        liveSessions: new Set(["external-build-session"]),
        stopCalls,
      }),
    });
    await expect(
      Effect.runPromise(
        guard.stopActiveTaskResetActivity({
          repoPath: "/repo",
          taskId: "task-1",
          sessions: [session()],
          operationLabel: "reset implementation",
          sessionRoles: ["build", "qa"],
        }),
      ),
    ).resolves.toEqual({ stoppedSessionCount: 1 });
    expect(stopCalls).toEqual(["external-build-session"]);
  });
  test("stops nothing when the matching runtime reports no live session", async () => {
    const stopCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ stopCalls }),
    });
    await expect(
      Effect.runPromise(
        guard.stopActiveTaskResetActivity({
          repoPath: "/repo",
          taskId: "task-1",
          sessions: [session()],
          operationLabel: "reset task",
          sessionRoles: ["spec", "planner", "build", "qa"],
        }),
      ),
    ).resolves.toEqual({ stoppedSessionCount: 0 });
    expect(stopCalls).toEqual([]);
  });
  test("probes sessions by durable runtime context", async () => {
    const probeCalls: unknown[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ probeCalls }),
    });
    await expect(
      Effect.runPromise(
        guard.stopActiveTaskResetActivity({
          repoPath: "/repo",
          taskId: "task-1",
          sessions: [session()],
          operationLabel: "reset task",
          sessionRoles: ["build"],
        }),
      ),
    ).resolves.toEqual({ stoppedSessionCount: 0 });
    expect(probeCalls).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/repo",
        externalSessionId: "external-build-session",
        workingDirectory: "/repo/worktree",
      },
    ]);
  });
  test("treats unsupported runtime probes as not live so destructive cleanup can proceed", async () => {
    const stopCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ probeSupported: false, stopCalls }),
    });
    await expect(
      Effect.runPromise(
        guard.stopActiveTaskResetActivity({
          repoPath: "/repo",
          taskId: "task-1",
          sessions: [session()],
          operationLabel: "reset implementation",
          sessionRoles: ["build"],
        }),
      ),
    ).resolves.toEqual({ stoppedSessionCount: 0 });
    expect(stopCalls).toEqual([]);
  });
  test("skips sessions outside the guarded roles and sessions without an external id", async () => {
    const probeCalls: unknown[] = [];
    const stopCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({
        liveSessions: new Set(["external-planner-session"]),
        probeCalls,
        stopCalls,
      }),
    });
    await expect(
      Effect.runPromise(
        guard.stopActiveTaskResetActivity({
          repoPath: "/repo",
          taskId: "task-1",
          sessions: [
            session({
              externalSessionId: "external-planner-session",
              role: "planner",
            }),
            session({ externalSessionId: "" }),
          ],
          operationLabel: "reset task",
          sessionRoles: ["build", "qa"],
        }),
      ),
    ).resolves.toEqual({ stoppedSessionCount: 0 });
    expect(probeCalls).toEqual([]);
    expect(stopCalls).toEqual([]);
  });
  test("stops live sessions across every target task before delete and reports the total", async () => {
    const stopCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({
        liveSessions: new Set(["external-qa-session", "external-build-session"]),
        stopCalls,
      }),
    });
    await expect(
      Effect.runPromise(
        guard.stopActiveTaskDeleteRuns({
          repoPath: "/repo",
          taskSessions: [
            {
              taskId: "task-1",
              sessions: [
                session({
                  externalSessionId: "external-qa-session",
                  role: "qa",
                }),
              ],
            },
            {
              taskId: "task-2",
              sessions: [session()],
            },
          ],
        }),
      ),
    ).resolves.toEqual({ stoppedSessionCount: 2 });
    expect(stopCalls).toEqual(["external-qa-session", "external-build-session"]);
  });
  test("surfaces stop failures as actionable errors instead of proceeding with cleanup", async () => {
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({
        liveSessions: new Set(["external-build-session"]),
        stopError: "runtime rejected abort",
      }),
    });
    await expect(
      Effect.runPromise(
        guard.stopActiveTaskResetActivity({
          repoPath: "/repo",
          taskId: "task-1",
          sessions: [session()],
          operationLabel: "reset implementation",
          sessionRoles: ["build"],
        }),
      ),
    ).rejects.toThrow(
      "Failed stopping live build session external-build-session: runtime rejected abort",
    );
  });
});
