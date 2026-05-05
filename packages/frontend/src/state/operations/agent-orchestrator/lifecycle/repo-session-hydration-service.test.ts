import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
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
});
