import type { AgentSessionLiveSnapshot, AgentSessionRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import { createRuntimeTaskActivityGuard as createEffectRuntimeTaskActivityGuard } from "./runtime-task-activity-guard";

const createRuntimeTaskActivityGuard = (
  input: Omit<
    Parameters<typeof createEffectRuntimeTaskActivityGuard>[0],
    "sessionService" | "settingsConfig"
  > & {
    sessionService?: Pick<AgentSessionLiveStateService, "list" | "releaseSession">;
    pathExists?: (path: string) => boolean;
  },
) =>
  createEffectRuntimeTaskActivityGuard({
    ...input,
    settingsConfig: {
      pathExists: (path) => Effect.succeed(input.pathExists?.(path) ?? true),
    },
    sessionService: input.sessionService ?? {
      list: () => Effect.succeed([]),
      releaseSession: () => Effect.void,
    },
  });
const registry = ({
  liveSessions = new Set<string>(),
  probeCalls = [],
  stopCalls = [],
  probeSupported = true,
  stopError = null,
  stopErrorSessionId = null,
}: {
  liveSessions?: Set<string>;
  probeCalls?: unknown[];
  stopCalls?: string[];
  probeSupported?: boolean;
  stopError?: string | null;
  stopErrorSessionId?: string | null;
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
        if (stopError && (!stopErrorSessionId || stopErrorSessionId === input.externalSessionId)) {
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
const snapshot = (): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath: "/repo",
    runtimeKind: "opencode",
    workingDirectory: "/repo/worktree",
    externalSessionId: "external-build-session",
  },
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  activity: "idle",
  title: "Build session",
  startedAt: "2026-05-10T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});
describe("createRuntimeTaskActivityGuard", () => {
  test("counts live sessions across tasks without stopping them", async () => {
    const probeCalls: unknown[] = [];
    const stopCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({
        liveSessions: new Set(["external-build-session"]),
        probeCalls,
        stopCalls,
      }),
    });
    await expect(
      Effect.runPromise(
        guard.countLiveSessions({
          repoPath: "/repo",
          taskSessions: [
            { taskId: "task-1", sessions: [session()] },
            {
              taskId: "task-2",
              sessions: [
                session({
                  externalSessionId: "external-idle-session",
                }),
              ],
            },
          ],
        }),
      ),
    ).resolves.toEqual({ liveSessionCount: 1 });
    expect(stopCalls).toEqual([]);
    expect(probeCalls).toHaveLength(2);
  });
  test("blocks session counts when a runtime cannot probe activity", async () => {
    const stopCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ probeSupported: false, stopCalls }),
    });
    await expect(
      Effect.runPromise(
        guard.countLiveSessions({
          repoPath: "/repo",
          taskSessions: [
            {
              taskId: "task-1",
              sessions: [session(), session({ externalSessionId: "" })],
            },
          ],
        }),
      ),
    ).rejects.toThrow(
      "Runtime opencode cannot check session external-build-session before task cleanup.",
    );
    expect(stopCalls).toEqual([]);
  });
  test("blocks session stops when a runtime cannot probe activity", async () => {
    const stopCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ probeSupported: false, stopCalls }),
    });
    await expect(
      Effect.runPromise(
        guard.cleanupTaskSessions({
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: [session()] }],
        }),
      ),
    ).rejects.toThrow(
      "Runtime opencode cannot check session external-build-session before task cleanup.",
    );
    expect(stopCalls).toEqual([]);
  });
  test("probes sessions by durable runtime context", async () => {
    const probeCalls: unknown[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ probeCalls }),
    });
    await expect(
      Effect.runPromise(
        guard.countLiveSessions({
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: [session()] }],
        }),
      ),
    ).resolves.toEqual({ liveSessionCount: 0 });
    expect(probeCalls).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/repo",
        externalSessionId: "external-build-session",
        workingDirectory: "/repo/worktree",
      },
    ]);
  });
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
        guard.cleanupTaskSessions({
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: [session()] }],
        }),
      ),
    ).resolves.toEqual({ stoppedSessionCount: 1 });
    expect(stopCalls).toEqual(["external-build-session"]);
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
        guard.cleanupTaskSessions({
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
  test("stops nothing when every runtime reports no live session", async () => {
    const stopCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ stopCalls }),
    });
    await expect(
      Effect.runPromise(
        guard.cleanupTaskSessions({
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: [session()] }],
        }),
      ),
    ).resolves.toEqual({ stoppedSessionCount: 0 });
    expect(stopCalls).toEqual([]);
  });
  test("releases an idle task session after checking runtime activity", async () => {
    const releaseCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry(),
      sessionService: {
        list: () => Effect.succeed([snapshot()]),
        releaseSession: (ref) =>
          Effect.sync(() => {
            releaseCalls.push(ref.externalSessionId);
          }),
      },
    });

    await expect(
      Effect.runPromise(
        guard.cleanupTaskSessions({
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: [session()] }],
        }),
      ),
    ).resolves.toEqual({ stoppedSessionCount: 0 });
    expect(releaseCalls).toEqual(["external-build-session"]);
  });
  test("releases a missing-worktree session without probing it", async () => {
    const probeCalls: unknown[] = [];
    const releaseCalls: string[] = [];
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({ probeCalls }),
      pathExists: () => false,
      sessionService: {
        list: () => Effect.succeed([snapshot()]),
        releaseSession: (ref) =>
          Effect.sync(() => {
            releaseCalls.push(ref.externalSessionId);
          }),
      },
    });

    await expect(
      Effect.runPromise(
        guard.cleanupTaskSessions({
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: [session()] }],
        }),
      ),
    ).resolves.toEqual({ stoppedSessionCount: 0 });
    expect(probeCalls).toEqual([]);
    expect(releaseCalls).toEqual(["external-build-session"]);
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
        guard.cleanupTaskSessions({
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: [session()] }],
        }),
      ),
    ).rejects.toThrow(
      "Failed stopping live build session external-build-session: runtime rejected abort",
    );
  });
  test("reports sessions stopped before a later stop failure", async () => {
    const releaseCalls: string[] = [];
    const buildSnapshot = snapshot();
    const qaSnapshot: AgentSessionLiveSnapshot = {
      ...buildSnapshot,
      ref: {
        ...buildSnapshot.ref,
        externalSessionId: "external-qa-session",
      },
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "qa" },
    };
    const guard = createRuntimeTaskActivityGuard({
      runtimeRegistry: registry({
        liveSessions: new Set(["external-build-session", "external-qa-session"]),
        stopError: "runtime rejected abort",
        stopErrorSessionId: "external-qa-session",
      }),
      sessionService: {
        list: () => Effect.succeed([buildSnapshot, qaSnapshot]),
        releaseSession: (ref) =>
          Effect.sync(() => {
            releaseCalls.push(ref.externalSessionId);
          }),
      },
    });

    const error = await Effect.runPromise(
      guard
        .cleanupTaskSessions({
          repoPath: "/repo",
          taskSessions: [
            {
              taskId: "task-1",
              sessions: [
                session(),
                session({ externalSessionId: "external-qa-session", role: "qa" }),
              ],
            },
          ],
        })
        .pipe(Effect.flip),
    );

    expect(error.message).toContain(
      "Failed stopping live qa session external-qa-session after stopping 1 earlier live agent session",
    );
    expect(error.details).toMatchObject({ stoppedSessionCount: 1 });
    expect(releaseCalls).toEqual(["external-build-session"]);
  });
});
