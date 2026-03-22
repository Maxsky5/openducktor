import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type TaskCard } from "@openducktor/contracts";
import { appQueryClient, clearAppQueryClient } from "@/lib/query-client";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import { host } from "../../shared/host";
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
      sessionId: `session-${taskId}`,
      externalSessionId,
      taskId,
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: worktreePath,
    },
  ],
});

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

    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath,
        taskId: null,
        role: "workspace",
        workingDirectory: worktreePath,
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

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
      runs: [],
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
        runtimeEndpoint: "http://127.0.0.1:4555",
        workingDirectory: worktreePath,
        externalSessionId: "external-1",
      })?.externalSessionId,
    ).toBe("external-1");
    expect(reconcileCalls.sort()).toEqual(["task-1", "task-2"]);
    service.dispose();
  });

  test("reconcile ensures a missing runtime kind only once even when multiple directories are missing", async () => {
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

    const taskOne = taskWithSession("task-1", "external-1");
    const taskTwo = taskWithSession("task-2", "external-2");
    const taskOneSession = taskOne.agentSessions?.[0];
    const taskTwoSession = taskTwo.agentSessions?.[0];
    if (!taskOneSession || !taskTwoSession) {
      throw new Error("Expected seeded task sessions");
    }
    taskOne.agentSessions = [
      {
        ...taskOneSession,
        workingDirectory: "/tmp/repo/worktree-a",
      },
    ];
    taskTwo.agentSessions = [
      {
        ...taskTwoSession,
        workingDirectory: "/tmp/repo/worktree-b",
      },
    ];

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
      runs: [],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(runtimeEnsureCalls).toBe(1);
    expect(listLiveAgentSessionSnapshotsCalls).toEqual([
      {
        directories: ["/tmp/repo/worktree-a", "/tmp/repo/worktree-b"],
      },
    ]);
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
      tasks: [taskWithSession("task-1", "external-1")],
      runs: [],
      isCancelled: () => false,
      isCurrentRepo: () => true,
    });

    expect(
      appQueryClient.getQueryState(runtimeQueryKeys.list("opencode", repoPath))?.isInvalidated,
    ).toBe(true);
    service.dispose();
  });

  afterEach(() => {
    host.runtimeList = originalRuntimeList;
    host.runtimeEnsure = originalRuntimeEnsure;
  });
});
