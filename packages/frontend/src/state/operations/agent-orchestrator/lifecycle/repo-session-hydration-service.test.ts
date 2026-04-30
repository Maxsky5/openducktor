import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import { LiveAgentSessionStore } from "./live-agent-session-store";
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
    const liveAgentSessionStore = new LiveAgentSessionStore();

    const service = createRepoSessionHydrationService({
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

  test("reconcile delegates repo-scoped persisted records without pre-scanning runtimes", async () => {
    const reconcileCalls: Array<{
      taskId: string;
      persistedRecords: AgentSessionRecord[];
    }> = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();

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
      liveAgentSessionStore,
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

  test("reconcile schedules retries when reconciliation throws", async () => {
    let retryRequests = 0;
    const reconcileCalls: string[] = [];
    const liveAgentSessionStore = new LiveAgentSessionStore();
    const retryTriggered = createDeferred<void>();

    const service = createRepoSessionHydrationService({
      sessionHydration: {
        bootstrapTaskSessions: async () => {},
        reconcileLiveTaskSessions: async ({ taskId }) => {
          reconcileCalls.push(taskId);
          throw new Error(`Failed to reconcile ${taskId}`);
        },
      },
      liveAgentSessionStore,
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
