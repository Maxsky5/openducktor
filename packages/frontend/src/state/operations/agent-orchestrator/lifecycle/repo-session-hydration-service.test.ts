import { describe, expect, mock, spyOn, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentSessionPresenceSnapshot } from "@openducktor/core";
import { createAgentSessionPresenceSnapshotFixture } from "../test-utils";
import { createRepoSessionHydrationService } from "./repo-session-hydration-service";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";

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
const runtimeReady = () => true;

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

describe("repo-session-hydration-service", () => {
  test("does not start bootstrap twice while the first bootstrap is still in flight", async () => {
    const deferred = createDeferred<void>();
    let bootstrapCalls = 0;
    let retryRequests = 0;

    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {
          bootstrapCalls += 1;
          await deferred.promise;
        },
        reconcileLiveTaskSessions: async () => {},
      },
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

  test("does not bootstrap a task again after the first bootstrap succeeds", async () => {
    const bootstrapTaskSessions = mock(async () => {});
    const task = taskWithSession("task-1", "external-1");
    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions,
        reconcileLiveTaskSessions: async () => {},
      },
      onRetryRequested: () => {},
    });

    await service.bootstrapPendingTasks({
      repoPath,
      tasks: [task],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });
    await service.bootstrapPendingTasks({
      repoPath,
      tasks: [task],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(bootstrapTaskSessions).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  test("does not mark empty-session tasks as bootstrapped", async () => {
    const bootstrapCalls: Array<{ taskId: string; records: AgentSessionRecord[] }> = [];
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

  test("reconciles pending tasks with a shared preloaded presence map", async () => {
    const presenceSnapshot = createAgentSessionPresenceSnapshotFixture({
      ref: { repoPath, runtimeKind: "opencode", workingDirectory: worktreePath },
    });
    const preloadedSessionPresenceByKey = new Map<string, AgentSessionPresenceSnapshot[]>([
      [agentSessionPresenceLookupKey(repoPath, "opencode", worktreePath), [presenceSnapshot]],
    ]);
    const reconcileCalls: Array<{
      taskId: string;
      persistedRecords: AgentSessionRecord[];
      preloaded: unknown;
    }> = [];
    const prepareRepoSessionPresencePreloads = mock(async ({ records }) => ({
      preloadedSessionPresenceByKey,
      recordCount: records.length,
    }));

    const taskOne = taskWithSession("task-1", "external-1");
    const taskTwo = taskWithSession("task-2", "external-2");
    const taskOneRecords = taskOne.agentSessions ?? [];
    const taskTwoRecords = taskTwo.agentSessions ?? [];
    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({
          taskId,
          persistedRecords,
          preloadedSessionPresenceByKey,
        }) => {
          if (!persistedRecords) {
            throw new Error("Expected persisted records for reconciliation");
          }
          reconcileCalls.push({
            taskId,
            persistedRecords,
            preloaded: preloadedSessionPresenceByKey,
          });
        },
      },
      prepareRepoSessionPresencePreloads,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [taskOne, taskTwo],
      isCancelled: () => false,
      isCurrentRepo: () => true,
      isRuntimeReady: runtimeReady,
    });

    expect(prepareRepoSessionPresencePreloads).toHaveBeenCalledTimes(1);
    expect(prepareRepoSessionPresencePreloads.mock.calls[0]?.[0].records).toEqual([
      ...taskOneRecords,
      ...taskTwoRecords,
    ]);
    expect(reconcileCalls).toEqual([
      {
        taskId: "task-1",
        persistedRecords: taskOneRecords,
        preloaded: preloadedSessionPresenceByKey,
      },
      {
        taskId: "task-2",
        persistedRecords: taskTwoRecords,
        preloaded: preloadedSessionPresenceByKey,
      },
    ]);
    service.dispose();
  });

  test("keeps pending records untouched until their runtime is ready", async () => {
    const reconcileLiveTaskSessions = mock(async () => {});
    const prepareRepoSessionPresencePreloads = mock(async () => ({
      preloadedSessionPresenceByKey: new Map(),
    }));
    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions,
      },
      prepareRepoSessionPresencePreloads,
      onRetryRequested: () => {},
    });
    const task = taskWithSession("task-1", "external-1");

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [task],
      isCancelled: () => false,
      isCurrentRepo: () => true,
      isRuntimeReady: () => false,
    });

    expect(prepareRepoSessionPresencePreloads).toHaveBeenCalledTimes(0);
    expect(reconcileLiveTaskSessions).toHaveBeenCalledTimes(0);

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [task],
      isCancelled: () => false,
      isCurrentRepo: () => true,
      isRuntimeReady: () => true,
    });

    expect(prepareRepoSessionPresencePreloads).toHaveBeenCalledTimes(1);
    expect(reconcileLiveTaskSessions).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  test("isolates records with invalid runtime metadata instead of aborting the reconcile batch", async () => {
    const invalidTask = taskWithSession("task-invalid", "external-invalid");
    invalidTask.agentSessions = [
      {
        ...(invalidTask.agentSessions?.[0] as AgentSessionRecord),
        // This deliberately simulates persisted data from an older/invalid schema.
        runtimeKind: "legacy-runtime" as AgentSessionRecord["runtimeKind"],
      },
    ];
    const validTask = taskWithSession("task-valid", "external-valid");
    const reconcileCalls: string[] = [];
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({ taskId }) => {
          reconcileCalls.push(taskId);
        },
      },
      onRetryRequested: () => {},
    });

    try {
      await service.reconcilePendingTasks({
        repoPath,
        tasks: [invalidTask, validTask],
        isCancelled: () => false,
        isCurrentRepo: () => true,
        isRuntimeReady: runtimeReady,
      });

      expect(reconcileCalls).toEqual(["task-valid"]);
      expect(
        consoleErrorSpy.mock.calls.some(([message]) =>
          String(message).includes("Failed to reconcile agent sessions for task 'task-invalid'"),
        ),
      ).toBe(true);
    } finally {
      service.dispose();
      consoleErrorSpy.mockRestore();
    }
  });

  test("hydrates durable sessions when live presence preload fails", async () => {
    const task = taskWithSession("task-1", "external-1");
    const taskRecords = task.agentSessions ?? [];
    const bootstrapCalls: Array<{ taskId: string; records: AgentSessionRecord[] }> = [];
    const reconcileLiveTaskSessions = mock(async () => {});
    const prepareRepoSessionPresencePreloads = mock(async () => {
      throw new Error("presence scan failed");
    });
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const service = createRepoSessionHydrationService({
        sessionHydration: {
          bootstrapTaskSessions: async (taskId, records) => {
            bootstrapCalls.push({ taskId, records: records ?? [] });
          },
          reconcileLiveTaskSessions,
        },
        prepareRepoSessionPresencePreloads,
        onRetryRequested: () => {},
      });

      await service.reconcilePendingTasks({
        repoPath,
        tasks: [task],
        isCancelled: () => false,
        isCurrentRepo: () => true,
        isRuntimeReady: runtimeReady,
      });

      expect(bootstrapCalls).toEqual([{ taskId: "task-1", records: taskRecords }]);
      expect(reconcileLiveTaskSessions).toHaveBeenCalledTimes(0);
      service.dispose();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test("does not reconcile unchanged task records twice", async () => {
    const reconcileLiveTaskSessions = mock(async () => {});
    const prepareRepoSessionPresencePreloads = mock(async () => ({
      preloadedSessionPresenceByKey: new Map(),
    }));
    const task = taskWithSession("task-1", "external-1");
    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions,
      },
      prepareRepoSessionPresencePreloads,
      onRetryRequested: () => {},
    });

    await service.reconcilePendingTasks({
      repoPath,
      tasks: [task],
      isCancelled: () => false,
      isCurrentRepo: () => true,
      isRuntimeReady: runtimeReady,
    });
    await service.reconcilePendingTasks({
      repoPath,
      tasks: [task],
      isCancelled: () => false,
      isCurrentRepo: () => true,
      isRuntimeReady: runtimeReady,
    });

    expect(prepareRepoSessionPresencePreloads).toHaveBeenCalledTimes(1);
    expect(reconcileLiveTaskSessions).toHaveBeenCalledTimes(1);
    service.dispose();
  });
});
