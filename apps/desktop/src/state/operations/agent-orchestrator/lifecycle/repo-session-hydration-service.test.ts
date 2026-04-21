import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type AgentSessionRecord,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeInstanceSummary,
  type TaskCard,
} from "@openducktor/contracts";
import { appQueryClient, clearAppQueryClient } from "@/lib/query-client";
import {
  createLiveAgentSessionSnapshotFixture,
  createLocalHttpRuntimeConnection,
} from "@/state/operations/agent-orchestrator/test-utils";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import { host } from "../../shared/host";
import { LiveAgentSessionStore } from "./live-agent-session-store";
import { createRuntimeResolutionPlannerStage } from "./load-sessions-stages";
import { createRepoSessionHydrationService } from "./repo-session-hydration-service";

const createDeferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
};

const repoPath = "/tmp/repo";
const worktreePath = "/tmp/repo/worktree";

const taskWithSession = (taskId: string, externalSessionId: string): TaskCard => ({
  id: taskId,
  title: taskId,
  description: "",
  notes: "",
  status: "open",
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
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
  agentSessions: [
    {
      runtimeKind: "opencode",
      sessionId: `session-${taskId}`,
      externalSessionId,
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: worktreePath,
      selectedModel: null,
    },
  ],
});

const taskWithSessionAt = (
  taskId: string,
  externalSessionId: string,
  workingDirectory: string,
): TaskCard => {
  const task = taskWithSession(taskId, externalSessionId);
  const session = task.agentSessions?.[0];
  if (!session) {
    throw new Error("Expected seeded task session");
  }
  task.agentSessions = [{ ...session, workingDirectory }];
  return task;
};

const plannerTaskWithSessionAt = (
  taskId: string,
  externalSessionId: string,
  workingDirectory: string,
): TaskCard => {
  const task = taskWithSessionAt(taskId, externalSessionId, workingDirectory);
  const session = task.agentSessions?.[0];
  if (!session) {
    throw new Error("Expected seeded task session");
  }

  task.agentSessions = [{ ...session, role: "planner", scenario: "planner_initial" }];
  return task;
};

const qaTaskWithSessionAt = (
  taskId: string,
  externalSessionId: string,
  workingDirectory: string,
): TaskCard => {
  const task = taskWithSessionAt(taskId, externalSessionId, workingDirectory);
  const session = task.agentSessions?.[0];
  if (!session) {
    throw new Error("Expected seeded task session");
  }

  task.agentSessions = [{ ...session, role: "qa", scenario: "qa_review" }];
  return task;
};

const createRuntimeInstance = ({
  runtimeId = "runtime-1",
  workingDirectory = worktreePath,
  runtimeRoute = {
    type: "local_http",
    endpoint: "http://127.0.0.1:4555",
  } as RuntimeInstanceSummary["runtimeRoute"],
}: {
  runtimeId?: string;
  workingDirectory?: string;
  runtimeRoute?: RuntimeInstanceSummary["runtimeRoute"];
} = {}): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId,
  repoPath,
  taskId: null,
  role: "workspace",
  workingDirectory,
  runtimeRoute,
  startedAt: "2026-02-22T08:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

const stdioRuntimeConnection = (workingDirectory: string) =>
  ({
    type: "stdio",
    workingDirectory,
  }) as const;

describe("repo-session-hydration-service", () => {
  const originalRuntimeList = host.runtimeList;
  const originalRuntimeEnsure = host.runtimeEnsure;

  beforeEach(async () => {
    await clearAppQueryClient();
    host.runtimeList = async () => [];
    host.runtimeEnsure = async () => {
      throw new Error("runtimeEnsure should not be called in this test");
    };
  });

  test("does not start bootstrap twice while the first bootstrap is still in flight", async () => {
    const deferred = createDeferred<void>();
    let bootstrapCalls = 0;
    let retryRequests = 0;
    const liveAgentSessionStore = new LiveAgentSessionStore();

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async () => [],
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {
          bootstrapCalls += 1;
          await deferred.promise;
        },
        reconcileLiveTaskSessions: async () => {},
      },
      liveAgentSessionStore,
      onRetryRequested: () => {
        retryRequests += 1;
      },
    });

    const tasks = [taskWithSession("task-1", "external-1")];
    const first = service.bootstrapPendingTasks({
      repoPath,
      tasks,
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });
    const second = service.bootstrapPendingTasks({
      repoPath,
      tasks,
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    deferred.resolve(undefined);
    await Promise.all([first, second]);

    expect(bootstrapCalls).toBe(1);
    expect(retryRequests).toBe(0);
    service.dispose();
  });

  test("reconcile scans each shared endpoint and directory only once", async () => {
    const listLiveAgentSessionSnapshotsCalls: Array<{ directories?: string[] }> = [];
    const reconcileCalls: string[] = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();

    host.runtimeList = async () => [createRuntimeInstance()];

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async (input) => {
          listLiveAgentSessionSnapshotsCalls.push(
            input.directories ? { directories: input.directories } : {},
          );
          return [
            {
              externalSessionId: "external-1",
              title: "Task 1",
              workingDirectory: worktreePath,
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
            },
            {
              externalSessionId: "external-2",
              title: "Task 2",
              workingDirectory: worktreePath,
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
            },
          ];
        },
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({ taskId }) => {
          reconcileCalls.push(taskId);
        },
      },
      liveAgentSessionStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [taskWithSession("task-1", "external-1"), taskWithSession("task-2", "external-2")],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(listLiveAgentSessionSnapshotsCalls).toEqual([
      {
        directories: [worktreePath],
      },
    ]);
    expect(
      liveAgentSessionStore.readSnapshot({
        repoPath,
        runtimeKind: "opencode",
        runtimeConnection: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4555",
          workingDirectory: worktreePath,
        },
        workingDirectory: worktreePath,
        externalSessionId: "external-1",
      })?.externalSessionId,
    ).toBe("external-1");
    expect(reconcileCalls.sort()).toEqual(["task-1", "task-2"]);
    service.dispose();
  });

  test("reconcile preloads live snapshots for later reattach without rescanning", async () => {
    const expectedExternalSessionId = "external-1";
    const liveSnapshot = createLiveAgentSessionSnapshotFixture({
      title: "Builder Session",
      workingDirectory: worktreePath,
      externalSessionId: expectedExternalSessionId,
    });
    const runtimeConnection = createLocalHttpRuntimeConnection({
      endpoint: "http://127.0.0.1:4555",
      workingDirectory: worktreePath,
    });
    let preloadScanCalls = 0;
    let reattachScanCalls = 0;
    let storedSnapshotBeforeClear: string | null = null;
    let storedSnapshotAfterClear: string | null = null;
    let reusedStoredSnapshot: string | null = null;
    let reusedPreloadedSnapshot: string | null = null;
    const liveAgentSessionStore = new LiveAgentSessionStore();

    host.runtimeList = async () => [createRuntimeInstance()];

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async () => {
          preloadScanCalls += 1;
          return [liveSnapshot];
        },
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({
          taskId,
          persistedRecords,
          preloadedRuntimeLists,
          preloadedRuntimeConnectionsByKey,
          preloadedLiveAgentSessionsByKey,
          allowRuntimeEnsure,
        }) => {
          const record = persistedRecords?.[0] as AgentSessionRecord | undefined;
          if (!record) {
            throw new Error("Expected persisted session record for reattach verification");
          }

          const plannerOptions = {
            ...(persistedRecords ? { persistedRecords } : {}),
            ...(preloadedRuntimeLists ? { preloadedRuntimeLists } : {}),
            ...(preloadedRuntimeConnectionsByKey ? { preloadedRuntimeConnectionsByKey } : {}),
            ...(preloadedLiveAgentSessionsByKey ? { preloadedLiveAgentSessionsByKey } : {}),
            ...(allowRuntimeEnsure !== undefined ? { allowRuntimeEnsure } : {}),
          };

          const createPlanner = (store?: LiveAgentSessionStore) =>
            createRuntimeResolutionPlannerStage({
              intent: {
                repoPath,
                workspaceId: "workspace-1",
                taskId,
                mode: "reconcile_live",
                requestedSessionId: null,
                requestedHistoryKey: null,
                shouldHydrateRequestedSession: false,
                shouldReconcileLiveSessions: true,
                historyPolicy: "none",
              },
              options: plannerOptions,
              adapter: {
                hasSession: () => false,
                loadSessionHistory: async () => [],
                resumeSession: async (input) => ({
                  sessionId: input.sessionId,
                  externalSessionId: input.externalSessionId,
                  role: input.role,
                  scenario: input.scenario,
                  startedAt: "2026-02-22T08:00:00.000Z",
                  status: "idle",
                  runtimeKind: input.runtimeKind,
                }),
                listLiveAgentSessionSnapshots: async () => {
                  reattachScanCalls += 1;
                  return [];
                },
              },
              sessionsRef: { current: {} },
              ...(store ? { liveAgentSessionStore: store } : {}),
              recordsToHydrate: persistedRecords ?? [],
              historyHydrationSessionIds: new Set<string>(),
            });

          const storedPlanner = await createPlanner(liveAgentSessionStore);
          const storedResolution = await storedPlanner.resolveHydrationRuntime(record);
          if (!storedResolution.ok) {
            throw new Error(`Expected runtime resolution to succeed for ${taskId}`);
          }
          reusedStoredSnapshot =
            (await storedPlanner.loadLiveAgentSessionSnapshot(record, storedResolution))
              ?.externalSessionId ?? null;

          storedSnapshotBeforeClear =
            liveAgentSessionStore.readSnapshot({
              repoPath,
              runtimeKind: "opencode",
              runtimeConnection,
              workingDirectory: worktreePath,
              externalSessionId: expectedExternalSessionId,
            })?.externalSessionId ?? null;

          liveAgentSessionStore.clearRepo(repoPath);

          storedSnapshotAfterClear =
            liveAgentSessionStore.readSnapshot({
              repoPath,
              runtimeKind: "opencode",
              runtimeConnection,
              workingDirectory: worktreePath,
              externalSessionId: expectedExternalSessionId,
            })?.externalSessionId ?? null;

          const preloadedPlanner = await createPlanner();
          const preloadedResolution = await preloadedPlanner.resolveHydrationRuntime(record);
          if (!preloadedResolution.ok) {
            throw new Error(`Expected preloaded runtime resolution to succeed for ${taskId}`);
          }
          reusedPreloadedSnapshot =
            (await preloadedPlanner.loadLiveAgentSessionSnapshot(record, preloadedResolution))
              ?.externalSessionId ?? null;
        },
      },
      liveAgentSessionStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [taskWithSession("task-1", expectedExternalSessionId)],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(preloadScanCalls).toBe(1);
    expect(reattachScanCalls).toBe(0);
    const storedSnapshotId = storedSnapshotBeforeClear;
    const reusedStoredSnapshotId = reusedStoredSnapshot;
    const reusedPreloadedSnapshotId = reusedPreloadedSnapshot;
    if (
      storedSnapshotId == null ||
      reusedStoredSnapshotId == null ||
      reusedPreloadedSnapshotId == null
    ) {
      throw new Error("Expected stored and preloaded live snapshot reuse to succeed");
    }
    expect(storedSnapshotId as string).toBe(expectedExternalSessionId);
    expect(storedSnapshotAfterClear).toBeNull();
    expect(reusedStoredSnapshotId as string).toBe(expectedExternalSessionId);
    expect(reusedPreloadedSnapshotId as string).toBe(expectedExternalSessionId);
    service.dispose();
  });

  test("reconcile keeps stdio runtimes for different worktrees on separate scan keys", async () => {
    const worktreeA = "/tmp/repo/worktree-a";
    const worktreeB = "/tmp/repo/worktree-b";
    const listLiveAgentSessionSnapshotsCalls: Array<{
      runtimeConnection: unknown;
      directories?: string[];
    }> = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();

    host.runtimeList = async () => [
      createRuntimeInstance({
        runtimeId: "runtime-stdio-a",
        workingDirectory: worktreeA,
        runtimeRoute: { type: "stdio" },
      }),
      createRuntimeInstance({
        runtimeId: "runtime-stdio-b",
        workingDirectory: worktreeB,
        runtimeRoute: { type: "stdio" },
      }),
    ];

    const taskOne = taskWithSessionAt("task-1", "external-1", worktreeA);
    const taskTwo = taskWithSessionAt("task-2", "external-2", worktreeB);

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async (input) => {
          listLiveAgentSessionSnapshotsCalls.push({
            runtimeConnection: input.runtimeConnection,
            ...(input.directories ? { directories: input.directories } : {}),
          });
          return [
            {
              externalSessionId:
                input.runtimeConnection.workingDirectory === worktreeA
                  ? "external-1"
                  : "external-2",
              title: "Task",
              workingDirectory: input.runtimeConnection.workingDirectory,
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
            },
          ];
        },
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async () => {},
      },
      liveAgentSessionStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [taskOne, taskTwo],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(listLiveAgentSessionSnapshotsCalls).toEqual([
      {
        runtimeConnection: stdioRuntimeConnection(worktreeA),
        directories: [worktreeA],
      },
      {
        runtimeConnection: stdioRuntimeConnection(worktreeB),
        directories: [worktreeB],
      },
    ]);
    expect(
      liveAgentSessionStore.readSnapshot({
        repoPath,
        runtimeKind: "opencode",
        runtimeConnection: stdioRuntimeConnection(worktreeA),
        workingDirectory: worktreeA,
        externalSessionId: "external-1",
      })?.externalSessionId,
    ).toBe("external-1");
    expect(
      liveAgentSessionStore.readSnapshot({
        repoPath,
        runtimeKind: "opencode",
        runtimeConnection: stdioRuntimeConnection(worktreeB),
        workingDirectory: worktreeB,
        externalSessionId: "external-2",
      })?.externalSessionId,
    ).toBe("external-2");
    service.dispose();
  });

  test("reconcile preloads stdio runtime snapshots into the live session store", async () => {
    const listLiveAgentSessionSnapshotsCalls: Array<{
      runtimeConnection: unknown;
      directories?: string[];
    }> = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();

    host.runtimeList = async () => [
      createRuntimeInstance({ runtimeId: "runtime-stdio", runtimeRoute: { type: "stdio" } }),
    ];

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async (input) => {
          listLiveAgentSessionSnapshotsCalls.push({
            runtimeConnection: input.runtimeConnection,
            ...(input.directories ? { directories: input.directories } : {}),
          });
          return [
            {
              externalSessionId: "external-1",
              title: "Task 1",
              workingDirectory: worktreePath,
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
            },
          ];
        },
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async () => {},
      },
      liveAgentSessionStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [taskWithSession("task-1", "external-1")],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(listLiveAgentSessionSnapshotsCalls).toEqual([
      {
        runtimeConnection: stdioRuntimeConnection(worktreePath),
        directories: [worktreePath],
      },
    ]);
    expect(
      liveAgentSessionStore.readSnapshot({
        repoPath,
        runtimeKind: "opencode",
        runtimeConnection: stdioRuntimeConnection(worktreePath),
        workingDirectory: worktreePath,
        externalSessionId: "external-1",
      })?.externalSessionId,
    ).toBe("external-1");
    service.dispose();
  });

  test("reconcile ensures a missing repo-root planner runtime only once", async () => {
    let runtimeEnsureCalls = 0;
    const listLiveAgentSessionSnapshotsCalls: Array<{ directories?: string[] }> = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();

    host.runtimeList = async () => [];
    host.runtimeEnsure = async () => {
      runtimeEnsureCalls += 1;
      return {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath,
        taskId: null,
        role: "workspace",
        workingDirectory: repoPath,
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      };
    };

    const taskOne = plannerTaskWithSessionAt("task-1", "external-1", repoPath);
    const taskTwo = plannerTaskWithSessionAt("task-2", "external-2", repoPath);

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async (input) => {
          listLiveAgentSessionSnapshotsCalls.push(
            input.directories ? { directories: [...input.directories].sort() } : {},
          );
          return [];
        },
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async () => {},
      },
      liveAgentSessionStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [taskOne, taskTwo],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(runtimeEnsureCalls).toBe(1);
    expect(listLiveAgentSessionSnapshotsCalls).toEqual([
      {
        directories: [repoPath],
      },
    ]);
    service.dispose();
  });

  test("reconcile scans normalized-equivalent repo-root planner directories", async () => {
    let runtimeEnsureCalls = 0;
    const listLiveAgentSessionSnapshotsCalls: Array<{ directories?: string[] }> = [];
    const reconcileCalls: string[] = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();

    host.runtimeList = async () => [createRuntimeInstance({ workingDirectory: repoPath })];
    host.runtimeEnsure = async () => {
      runtimeEnsureCalls += 1;
      return createRuntimeInstance({ workingDirectory: repoPath });
    };

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async (input) => {
          listLiveAgentSessionSnapshotsCalls.push(
            input.directories ? { directories: [...input.directories].sort() } : {},
          );
          return [
            createLiveAgentSessionSnapshotFixture({
              externalSessionId: "external-1",
              workingDirectory: repoPath,
            }),
          ];
        },
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({ taskId }) => {
          reconcileCalls.push(taskId);
        },
      },
      liveAgentSessionStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [plannerTaskWithSessionAt("task-1", "external-1", `${repoPath}/`)],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(runtimeEnsureCalls).toBe(0);
    expect(listLiveAgentSessionSnapshotsCalls).toEqual([
      {
        directories: [repoPath],
      },
    ]);
    expect(reconcileCalls).toEqual(["task-1"]);
    service.dispose();
  });

  test("reconcile still hydrates worktree sessions when the runtime is resolvable but no live snapshots remain", async () => {
    const listLiveAgentSessionSnapshotsCalls: Array<{ directories?: string[] }> = [];
    const reconcileCalls: string[] = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();

    host.runtimeList = async () => [createRuntimeInstance({ workingDirectory: repoPath })];

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async (input) => {
          listLiveAgentSessionSnapshotsCalls.push(
            input.directories ? { directories: [...input.directories].sort() } : {},
          );
          return [];
        },
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({ taskId }) => {
          reconcileCalls.push(taskId);
        },
      },
      liveAgentSessionStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [qaTaskWithSessionAt("task-1", "external-1", worktreePath)],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(listLiveAgentSessionSnapshotsCalls).toEqual([
      {
        directories: [worktreePath],
      },
    ]);
    expect(reconcileCalls).toEqual(["task-1"]);
    service.dispose();
  });

  test("reconcile does not ensure missing stdio worktree runtimes", async () => {
    let runtimeEnsureCalls = 0;
    const listLiveAgentSessionSnapshotsCalls: Array<{
      runtimeConnection: unknown;
      directories?: string[];
    }> = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();

    host.runtimeList = async () => [];
    host.runtimeEnsure = async () => {
      runtimeEnsureCalls += 1;
      return createRuntimeInstance({
        runtimeId: "runtime-stdio-root",
        workingDirectory: repoPath,
        runtimeRoute: { type: "stdio" },
      });
    };

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async (input) => {
          listLiveAgentSessionSnapshotsCalls.push({
            runtimeConnection: input.runtimeConnection,
            ...(input.directories ? { directories: [...input.directories].sort() } : {}),
          });
          return [];
        },
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async () => {},
      },
      liveAgentSessionStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [
        taskWithSessionAt("task-1", "external-1", "/tmp/repo/worktree-a"),
        taskWithSessionAt("task-2", "external-2", "/tmp/repo/worktree-b"),
      ],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(runtimeEnsureCalls).toBe(0);
    expect(listLiveAgentSessionSnapshotsCalls).toEqual([]);
    service.dispose();
  });

  test("reconcile invalidates runtime list queries after ensuring a missing runtime", async () => {
    const liveAgentSessionStore = new LiveAgentSessionStore();
    host.runtimeList = async () => [];
    host.runtimeEnsure = async () => ({
      kind: "opencode",
      runtimeId: "runtime-1",
      repoPath,
      taskId: null,
      role: "workspace",
      workingDirectory: repoPath,
      runtimeRoute: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4555",
      },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    });
    appQueryClient.setQueryData(runtimeQueryKeys.list("opencode", repoPath), []);

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async () => [],
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async () => {},
      },
      liveAgentSessionStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [plannerTaskWithSessionAt("task-1", "external-1", repoPath)],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(
      appQueryClient.getQueryState(runtimeQueryKeys.list("opencode", repoPath))?.isInvalidated,
    ).toBe(true);
    service.dispose();
  });

  test("reconcile skips deterministic persisted runtime metadata failures without scheduling retries", async () => {
    let retryRequests = 0;
    const reconcileCalls: string[] = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();
    const retryTriggered = createDeferred<void>();

    host.runtimeList = async () => [createRuntimeInstance()];

    const invalidTask = taskWithSession("task-invalid", "external-invalid");
    const invalidSession = invalidTask.agentSessions?.[0];
    if (!invalidSession) {
      throw new Error("Expected invalid task session fixture");
    }
    invalidTask.agentSessions = [
      {
        ...invalidSession,
        runtimeKind: undefined as unknown as typeof invalidSession.runtimeKind,
      },
    ];

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-valid",
            title: "Valid task",
            workingDirectory: worktreePath,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({ taskId }) => {
          reconcileCalls.push(taskId);
        },
      },
      liveAgentSessionStore,
      onRetryRequested: () => {
        retryRequests += 1;
        retryTriggered.resolve();
      },
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [taskWithSession("task-valid", "external-valid"), invalidTask],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    const retryResult = await Promise.race([
      retryTriggered.promise.then(() => "retried" as const),
      Bun.sleep(600).then(() => "timeout" as const),
    ]);

    expect(reconcileCalls).toEqual(["task-valid"]);
    expect(retryRequests).toBe(0);
    expect(retryResult).toBe("timeout");
    service.dispose();
  });

  test("reconcile skips tasks atomically when a later persisted session has invalid runtime metadata", async () => {
    const reconcileCalls: string[] = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();

    host.runtimeList = async () => [createRuntimeInstance()];

    const partiallyInvalidTask = taskWithSession("task-invalid", "external-partial");
    const partiallyInvalidSession = partiallyInvalidTask.agentSessions?.[0];
    if (!partiallyInvalidSession) {
      throw new Error("Expected partially invalid task session fixture");
    }
    partiallyInvalidTask.agentSessions = [
      partiallyInvalidSession,
      {
        ...partiallyInvalidSession,
        sessionId: "session-task-invalid-broken",
        externalSessionId: "external-broken",
        runtimeKind: undefined as unknown as typeof partiallyInvalidSession.runtimeKind,
      },
    ];

    const service = createRepoSessionHydrationService({
      agentEngine: {
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-valid",
            title: "Valid task",
            workingDirectory: worktreePath,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
          {
            externalSessionId: "external-partial",
            title: "Partially invalid task",
            workingDirectory: worktreePath,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
      },
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({ taskId }) => {
          reconcileCalls.push(taskId);
        },
      },
      liveAgentSessionStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [taskWithSession("task-valid", "external-valid"), partiallyInvalidTask],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(reconcileCalls).toEqual(["task-valid"]);
    service.dispose();
  });

  afterEach(() => {
    host.runtimeList = originalRuntimeList;
    host.runtimeEnsure = originalRuntimeEnsure;
  });
});
