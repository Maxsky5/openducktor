import { describe, expect, test } from "bun:test";
import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentSessionPresenceSnapshot } from "@openducktor/core";
import { createRepoSessionHydrationService } from "./repo-session-hydration-service";
import { AgentSessionPresenceStore } from "./session-presence-store";

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
      externalSessionId,
      role: "build",
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

const withSuppressedExpectedConsoleErrors = async ({
  expectedCount,
  isExpected,
  run,
}: {
  expectedCount: number;
  isExpected: (args: Parameters<typeof console.error>) => boolean;
  run: () => Promise<void>;
}): Promise<void> => {
  const originalError = console.error;
  let suppressedCount = 0;
  console.error = (...args: Parameters<typeof console.error>): void => {
    if (isExpected(args)) {
      suppressedCount += 1;
      return;
    }

    originalError(...args);
  };

  try {
    await run();
    expect(suppressedCount).toBe(expectedCount);
  } finally {
    console.error = originalError;
  }
};

describe("repo-session-hydration-service", () => {
  test("does not start bootstrap twice while the first bootstrap is still in flight", async () => {
    const deferred = createDeferred<void>();
    let bootstrapCalls = 0;
    let retryRequests = 0;
    const agentSessionPresenceStore = new AgentSessionPresenceStore();

    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {
          bootstrapCalls += 1;
          await deferred.promise;
        },
        reconcileLiveTaskSessions: async () => {},
      },
      agentSessionPresenceStore,
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

  test("reconcile delegates repo-scoped persisted records without pre-scanning runtimes", async () => {
    const reconcileCalls: Array<{
      taskId: string;
      persistedRecords?: AgentSessionRecord[];
    }> = [];
    const agentSessionPresenceStore = new AgentSessionPresenceStore();

    const mixedTask = taskWithSessionAt("task-mixed", "external-repo", repoPath);
    const firstSession = mixedTask.agentSessions?.[0];
    if (!firstSession) {
      throw new Error("Expected seeded task session");
    }
    mixedTask.agentSessions = [
      firstSession,
      {
        ...firstSession,
        externalSessionId: "external-worktree",
        workingDirectory: worktreePath,
      },
    ];

    const emptyTask = taskWithSessionAt("task-empty", "external-empty", repoPath);
    emptyTask.agentSessions = [];

    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async (input) => {
          reconcileCalls.push(
            input as {
              taskId: string;
              persistedRecords: AgentSessionRecord[];
            },
          );
        },
      },
      agentSessionPresenceStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [mixedTask, emptyTask],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(reconcileCalls).toEqual([
      {
        taskId: "task-mixed",
        persistedRecords: [
          {
            ...firstSession,
            externalSessionId: "external-repo",
            workingDirectory: repoPath,
          },
          {
            ...firstSession,
            externalSessionId: "external-worktree",
            workingDirectory: worktreePath,
          },
        ],
      },
    ]);
    service.dispose();
  });

  test("does not reconcile unchanged persisted records more than once", async () => {
    const reconcileCalls: string[] = [];
    const agentSessionPresenceStore = new AgentSessionPresenceStore();
    const task = taskWithSession("task-1", "external-1");

    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({ taskId }) => {
          reconcileCalls.push(taskId);
        },
      },
      agentSessionPresenceStore,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [task],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });
    await service.reconcilePendingTasks({
      repoPath,
      tasks: [task],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(reconcileCalls).toEqual(["task-1"]);
    service.dispose();
  });

  test("reconcile preloads repo session presence once and shares it with every pending task", async () => {
    const reconcileCalls: Array<{
      taskId: string;
      persistedRecords?: AgentSessionRecord[];
      preloadedRuntimeLists?: Map<RuntimeKind, RuntimeInstanceSummary[]>;
      preloadedSessionPresenceByKey?: Map<string, AgentSessionPresenceSnapshot[]>;
    }> = [];
    const preloadCalls: AgentSessionRecord[][] = [];
    const agentSessionPresenceStore = new AgentSessionPresenceStore();
    const preloadedRuntimeLists = new Map<RuntimeKind, RuntimeInstanceSummary[]>();
    const preloadedSessionPresenceByKey = new Map<string, AgentSessionPresenceSnapshot[]>();
    const taskA = taskWithSessionAt("task-a", "external-a", "/tmp/repo/worktree-a");
    const firstTaskASession = taskA.agentSessions?.[0];
    if (!firstTaskASession) {
      throw new Error("Expected seeded task session");
    }
    taskA.agentSessions = [
      firstTaskASession,
      { ...firstTaskASession, externalSessionId: "external-a-2" },
    ];
    const taskB = taskWithSessionAt("task-b", "external-b", "/tmp/repo/worktree-b");
    const emptyTask = taskWithSession("task-empty", "external-empty");
    emptyTask.agentSessions = [];

    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async (input) => {
          reconcileCalls.push(input);
        },
      },
      agentSessionPresenceStore,
      prepareRepoSessionPresencePreloads: async ({ records }) => {
        preloadCalls.push(records);
        return { preloadedRuntimeLists, preloadedSessionPresenceByKey };
      },
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [taskA, taskB, emptyTask],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });
    await service.reconcilePendingTasks({
      repoPath,
      tasks: [taskA, taskB, emptyTask],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(preloadCalls).toEqual([
      [...(taskA.agentSessions ?? []), ...(taskB.agentSessions ?? [])],
    ]);
    expect(reconcileCalls).toHaveLength(2);
    expect(reconcileCalls.map((call) => call.taskId).sort()).toEqual(["task-a", "task-b"]);
    for (const call of reconcileCalls) {
      expect(call.preloadedRuntimeLists).toBe(preloadedRuntimeLists);
      expect(call.preloadedSessionPresenceByKey).toBe(preloadedSessionPresenceByKey);
    }
    service.dispose();
  });

  test("reconcile schedules one repo retry when repo preload fails", async () => {
    let retryRequests = 0;
    const reconcileCalls: string[] = [];
    const agentSessionPresenceStore = new AgentSessionPresenceStore();
    const retryTriggered = createDeferred<void>();

    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({ taskId }) => {
          reconcileCalls.push(taskId);
        },
      },
      agentSessionPresenceStore,
      prepareRepoSessionPresencePreloads: async () => {
        throw new Error("preload failed");
      },
      onRetryRequested: () => {
        retryRequests += 1;
        retryTriggered.resolve();
      },
    });

    await withSuppressedExpectedConsoleErrors({
      expectedCount: 1,
      isExpected: (args) =>
        typeof args[0] === "string" &&
        args[0].startsWith("Failed to preload agent session presence for repo '/tmp/repo'"),
      run: async () => {
        await service.reconcilePendingTasks({
          repoPath,
          tasks: [taskWithSession("task-a", "external-a"), taskWithSession("task-b", "external-b")],
          isCancelled: () => false,
          isCurrentRepo: () => true,
        });
      },
    });

    const retryResult = await Promise.race([
      retryTriggered.promise.then(() => "retried" as const),
      Bun.sleep(600).then(() => "timeout" as const),
    ]);

    expect(reconcileCalls).toEqual([]);
    expect(retryRequests).toBe(1);
    expect(retryResult).toBe("retried");
    service.dispose();
  });

  test("does not mark empty-session tasks as bootstrapped", async () => {
    const bootstrapCalls: Array<{ taskId: string; records: AgentSessionRecord[] }> = [];
    const agentSessionPresenceStore = new AgentSessionPresenceStore();
    const emptyTask = taskWithSession("task-1", "external-1");
    emptyTask.agentSessions = [];
    const taskWithLaterSession = taskWithSession("task-1", "external-1");

    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async (taskId, records) => {
          bootstrapCalls.push({ taskId, records: records ?? [] });
        },
        reconcileLiveTaskSessions: async () => {},
      },
      agentSessionPresenceStore,
      onRetryRequested: () => {},
    });

    await service.bootstrapPendingTasks({
      repoPath,
      tasks: [emptyTask],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });
    await service.bootstrapPendingTasks({
      repoPath,
      tasks: [taskWithLaterSession],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(bootstrapCalls).toEqual([
      { taskId: "task-1", records: taskWithLaterSession.agentSessions ?? [] },
    ]);
    service.dispose();
  });

  test("reconcile schedules retries when reconciliation throws", async () => {
    let retryRequests = 0;
    const reconcileCalls: string[] = [];
    const agentSessionPresenceStore = new AgentSessionPresenceStore();
    const retryTriggered = createDeferred<void>();

    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({ taskId }) => {
          reconcileCalls.push(taskId);
          throw new Error(`Failed to reconcile ${taskId}`);
        },
      },
      agentSessionPresenceStore,
      onRetryRequested: () => {
        retryRequests += 1;
        retryTriggered.resolve();
      },
    });

    await withSuppressedExpectedConsoleErrors({
      expectedCount: 1,
      isExpected: (args) =>
        typeof args[0] === "string" &&
        args[0].startsWith("Failed to reconcile agent sessions for task 'task-failing'"),
      run: async () => {
        await service.reconcilePendingTasks({
          repoPath,
          tasks: [taskWithSession("task-failing", "external-failing")],
          isCancelled: () => false,
          isCurrentRepo: () => true,
        });
      },
    });

    const retryResult = await Promise.race([
      retryTriggered.promise.then(() => "retried" as const),
      Bun.sleep(600).then(() => "timeout" as const),
    ]);

    expect(reconcileCalls).toEqual(["task-failing"]);
    expect(retryRequests).toBe(1);
    expect(retryResult).toBe("retried");
    service.dispose();
  });
});
