import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BeadsCheck, RunSummary, TaskCard, TaskCreateInput } from "@openducktor/contracts";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { toast } from "sonner";
import { clearAppQueryClient } from "@/lib/query-client";
import { host } from "../shared/host";
import { useTaskOperations } from "./use-task-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createDeferred = <T,>() => {
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

const makeTask = (id: string, status: TaskCard["status"]): TaskCard => ({
  id,
  title: id,
  description: "",
  notes: "",
  status,
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
});

type HookArgs = Parameters<typeof useTaskOperations>[0];

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: ReturnType<typeof useTaskOperations> | null = null;
  let currentArgs = initialArgs;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useTaskOperations(args);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  return {
    mount: async () => {
      await act(async () => {
        renderer = TestRenderer.create(createElement(Harness, { args: currentArgs }));
      });
      await flush();
    },
    updateArgs: async (nextArgs: HookArgs) => {
      currentArgs = nextArgs;
      await act(async () => {
        renderer?.update(createElement(Harness, { args: currentArgs }));
      });
      await flush();
    },
    run: async (fn: (value: ReturnType<typeof useTaskOperations>) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await act(async () => {
        await fn(latest as ReturnType<typeof useTaskOperations>);
      });
      await flush();
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    unmount: async () => {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    },
  };
};

describe("use-task-operations", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
  });

  test("refreshTaskData filters deferred tasks and loads runs", async () => {
    const tasksList = mock(async () => [makeTask("A", "open"), makeTask("B", "deferred")]);
    const runsList = mock(
      async (): Promise<RunSummary[]> => [
        {
          runId: "run-1",
          runtimeKind: "opencode",
          runtimeRoute: {
            type: "local_http",
            endpoint: "http://127.0.0.1:3000",
          },
          repoPath: "/repo",
          taskId: "A",
          branch: "feature/a",
          worktreePath: "/tmp/repo",
          port: 3000,
          state: "running",
          lastMessage: "working",
          startedAt: "2026-02-22T08:00:00.000Z",
        },
      ],
    );

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshTaskData("/repo");
      });

      expect(harness.getLatest().tasks.map((task) => task.id)).toEqual(["A"]);
      expect(harness.getLatest().runs).toHaveLength(1);
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(runsList).toHaveBeenCalledWith("/repo");
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("refreshTaskData bypasses stale cached task data on repeated explicit refreshes", async () => {
    const tasksList = mock(async () => [makeTask("A", "open")]);
    tasksList.mockImplementationOnce(async () => [makeTask("A", "open")]);
    tasksList.mockImplementationOnce(async () => [makeTask("A", "ready_for_dev")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshTaskData("/repo");
      });
      expect(harness.getLatest().tasks[0]?.status).toBe("open");

      await harness.run(async (value) => {
        await value.refreshTaskData("/repo");
      });

      expect(tasksList).toHaveBeenCalledTimes(2);
      expect(runsList).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().tasks[0]?.status).toBe("ready_for_dev");
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("resetTaskImplementation refreshes task data after host reset completes", async () => {
    const taskResetImplementation = mock(async () => makeTask("A", "ready_for_dev"));
    const tasksList = mock(async () => [makeTask("A", "in_progress")]);
    tasksList.mockImplementationOnce(async () => [makeTask("A", "in_progress")]);
    tasksList.mockImplementationOnce(async () => [makeTask("A", "ready_for_dev")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskResetImplementation: host.taskResetImplementation,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskResetImplementation = taskResetImplementation;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshTaskData("/repo");
      });
      expect(harness.getLatest().tasks[0]?.status).toBe("in_progress");

      await harness.run(async (value) => {
        await value.resetTaskImplementation("A");
      });

      expect(taskResetImplementation).toHaveBeenCalledWith("/repo", "A");
      expect(harness.getLatest().tasks[0]?.status).toBe("ready_for_dev");
    } finally {
      await harness.unmount();
      host.taskResetImplementation = original.taskResetImplementation;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("resetTaskImplementation surfaces a toast and rethrows when reset fails", async () => {
    const taskResetImplementation = mock(async () => {
      throw new Error("reset failed");
    });
    const toastError = mock(() => {});

    const original = {
      taskResetImplementation: host.taskResetImplementation,
      toastError: toast.error,
    };
    host.taskResetImplementation = taskResetImplementation;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await expect(
        harness.run(async (value) => {
          await value.resetTaskImplementation("A");
        }),
      ).rejects.toThrow("reset failed");
      expect(toastError).toHaveBeenCalledWith("Failed to reset implementation", {
        description: "reset failed",
      });
    } finally {
      await harness.unmount();
      host.taskResetImplementation = original.taskResetImplementation;
      toast.error = original.toastError;
    }
  });

  test("ignores stale refreshTaskData results after active repo switches", async () => {
    const deferredTasks = createDeferred<TaskCard[]>();
    const deferredRuns = createDeferred<RunSummary[]>();
    const tasksList = mock(async () => deferredTasks.promise);
    const runsList = mock(async () => deferredRuns.promise);

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;

    const refreshBeadsCheckForRepo = async (): Promise<BeadsCheck> => ({
      beadsOk: true,
      beadsPath: "/repo-a/.beads",
      beadsError: null,
    });
    const harness = createHookHarness({
      activeRepo: "/repo-a",
      refreshBeadsCheckForRepo,
    });

    try {
      await harness.mount();

      let refreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        refreshPromise = value.refreshTaskData("/repo-a");
      });

      if (!refreshPromise) {
        throw new Error("refreshTaskData promise was not captured");
      }

      await harness.updateArgs({
        activeRepo: "/repo-b",
        refreshBeadsCheckForRepo,
      });

      deferredTasks.resolve([makeTask("A", "open")]);
      deferredRuns.resolve([
        {
          runId: "run-a",
          runtimeKind: "opencode",
          runtimeRoute: {
            type: "local_http",
            endpoint: "http://127.0.0.1:3100",
          },
          repoPath: "/repo-a",
          taskId: "A",
          branch: "feature/a",
          worktreePath: "/tmp/repo-a",
          port: 3100,
          state: "running",
          lastMessage: null,
          startedAt: "2026-02-22T08:00:00.000Z",
        },
      ]);

      await refreshPromise;
      await flush();

      expect(harness.getLatest().tasks).toEqual([]);
      expect(harness.getLatest().runs).toEqual([]);
    } finally {
      deferredTasks.resolve([]);
      deferredRuns.resolve([]);
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("refreshTasks continues loading task data when pull request sync fails", async () => {
    const repoPullRequestSync = mock(async () => {
      throw new Error("gh auth expired");
    });
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(repoPullRequestSync).toHaveBeenCalledWith("/repo");
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(harness.getLatest().tasks.map((task) => task.id)).toEqual(["A"]);
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("syncPullRequests links a detected pull request for the task", async () => {
    const taskPullRequestDetect = mock(async () => ({
      outcome: "linked" as const,
      pullRequest: {
        providerId: "github",
        number: 17,
        url: "https://github.com/openai/openducktor/pull/17",
        state: "open" as const,
        createdAt: "2026-02-20T10:00:00Z",
        updatedAt: "2026-02-20T10:00:00Z",
        lastSyncedAt: "2026-02-20T10:00:00Z",
        mergedAt: undefined,
        closedAt: undefined,
      },
    }));
    const tasksList = mock(async () => [
      {
        ...makeTask("A", "human_review"),
        pullRequest: {
          providerId: "github",
          number: 17,
          url: "https://github.com/openai/openducktor/pull/17",
          state: "open" as const,
          createdAt: "2026-02-20T10:00:00Z",
          updatedAt: "2026-02-20T10:00:00Z",
          lastSyncedAt: "2026-02-20T10:00:00Z",
          mergedAt: undefined,
          closedAt: undefined,
        },
      },
    ]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const originalToastSuccess = toast.success;
    const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { success: typeof toast.success }).success =
      toastSuccess as unknown as typeof toast.success;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });

      expect(taskPullRequestDetect).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(runsList).toHaveBeenCalledWith("/repo");
      expect(harness.getLatest().tasks[0]?.pullRequest?.number).toBe(17);
      expect(toastSuccess).toHaveBeenCalledWith("Pull request linked", {
        description: "PR #17",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.success = originalToastSuccess;
    }
  });

  test("syncPullRequests tracks only the detecting task while the request is pending", async () => {
    const detection = createDeferred<{
      outcome: "linked";
      pullRequest: {
        providerId: "github";
        number: number;
        url: string;
        state: "open";
        createdAt: string;
        updatedAt: string;
        lastSyncedAt: string;
        mergedAt: undefined;
        closedAt: undefined;
      };
    }>();
    const taskPullRequestDetect = mock(async () => detection.promise);
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();

      let syncPromise: Promise<void> | null = null;
      await harness.run((value) => {
        syncPromise = value.syncPullRequests("A");
      });

      expect(harness.getLatest().detectingPullRequestTaskId).toBe("A");
      expect(harness.getLatest().unlinkingPullRequestTaskId).toBeNull();
      expect(harness.getLatest().isLoadingTasks).toBe(false);

      await act(async () => {
        detection.resolve({
          outcome: "linked",
          pullRequest: {
            providerId: "github",
            number: 17,
            url: "https://github.com/openai/openducktor/pull/17",
            state: "open",
            createdAt: "2026-02-20T10:00:00Z",
            updatedAt: "2026-02-20T10:00:00Z",
            lastSyncedAt: "2026-02-20T10:00:00Z",
            mergedAt: undefined,
            closedAt: undefined,
          },
        });
        await syncPromise;
      });
      await flush();

      expect(harness.getLatest().detectingPullRequestTaskId).toBeNull();
    } finally {
      detection.resolve({
        outcome: "linked",
        pullRequest: {
          providerId: "github",
          number: 17,
          url: "https://github.com/openai/openducktor/pull/17",
          state: "open",
          createdAt: "2026-02-20T10:00:00Z",
          updatedAt: "2026-02-20T10:00:00Z",
          lastSyncedAt: "2026-02-20T10:00:00Z",
          mergedAt: undefined,
          closedAt: undefined,
        },
      });
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("syncPullRequests stores merged pull requests for confirmation", async () => {
    const taskPullRequestDetect = mock(async () => ({
      outcome: "merged" as const,
      pullRequest: {
        providerId: "github",
        number: 17,
        url: "https://github.com/openai/openducktor/pull/17",
        state: "merged" as const,
        createdAt: "2026-02-20T10:00:00Z",
        updatedAt: "2026-02-20T10:00:00Z",
        lastSyncedAt: "2026-02-20T10:00:00Z",
        mergedAt: "2026-02-20T10:00:00Z",
        closedAt: "2026-02-20T10:00:00Z",
      },
    }));
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });

      expect(taskPullRequestDetect).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).not.toHaveBeenCalled();
      expect(runsList).not.toHaveBeenCalled();
      expect(harness.getLatest().pendingMergedPullRequest).toEqual({
        taskId: "A",
        pullRequest: {
          providerId: "github",
          number: 17,
          url: "https://github.com/openai/openducktor/pull/17",
          state: "merged",
          createdAt: "2026-02-20T10:00:00Z",
          updatedAt: "2026-02-20T10:00:00Z",
          lastSyncedAt: "2026-02-20T10:00:00Z",
          mergedAt: "2026-02-20T10:00:00Z",
          closedAt: "2026-02-20T10:00:00Z",
        },
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("linkMergedPullRequest links the merged pull request and refreshes task data", async () => {
    const taskPullRequestDetect = mock(async () => ({
      outcome: "merged" as const,
      pullRequest: {
        providerId: "github",
        number: 17,
        url: "https://github.com/openai/openducktor/pull/17",
        state: "merged" as const,
        createdAt: "2026-02-20T10:00:00Z",
        updatedAt: "2026-02-20T10:00:00Z",
        lastSyncedAt: "2026-02-20T10:00:00Z",
        mergedAt: "2026-02-20T10:00:00Z",
        closedAt: "2026-02-20T10:00:00Z",
      },
    }));
    const taskPullRequestLinkMerged = mock(async () => makeTask("A", "closed"));
    const tasksList = mock(async () => [makeTask("A", "closed")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      taskPullRequestLinkMerged: host.taskPullRequestLinkMerged,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.taskPullRequestLinkMerged = taskPullRequestLinkMerged;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const originalToastSuccess = toast.success;
    const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { success: typeof toast.success }).success =
      toastSuccess as unknown as typeof toast.success;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });
      await harness.run(async (value) => {
        await value.linkMergedPullRequest();
      });

      expect(taskPullRequestLinkMerged).toHaveBeenCalledWith("/repo", "A", {
        providerId: "github",
        number: 17,
        url: "https://github.com/openai/openducktor/pull/17",
        state: "merged",
        createdAt: "2026-02-20T10:00:00Z",
        updatedAt: "2026-02-20T10:00:00Z",
        lastSyncedAt: "2026-02-20T10:00:00Z",
        mergedAt: "2026-02-20T10:00:00Z",
        closedAt: "2026-02-20T10:00:00Z",
      });
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(runsList).toHaveBeenCalledWith("/repo");
      expect(harness.getLatest().pendingMergedPullRequest).toBeNull();
      expect(harness.getLatest().linkingMergedPullRequestTaskId).toBeNull();
      expect(toastSuccess).toHaveBeenCalledWith("Merged pull request linked", {
        description: "PR #17; task moved to Done.",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.taskPullRequestLinkMerged = original.taskPullRequestLinkMerged;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.success = originalToastSuccess;
    }
  });

  test("linkMergedPullRequest surfaces an actionable error when merged PR state is missing", async () => {
    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.linkMergedPullRequest();
      });

      expect(toastError).toHaveBeenCalledWith("Merged pull request state expired", {
        description: "Re-run pull request detection and try again.",
      });
    } finally {
      await harness.unmount();
      toast.error = originalToastError;
    }
  });

  test("syncPullRequests warns when no pull request exists for the task branch", async () => {
    const taskPullRequestDetect = mock(async () => ({
      outcome: "not_found" as const,
      sourceBranch: "odt/task-1",
      targetBranch: "main",
    }));
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const originalToastWarning = toast.warning;
    const toastWarning = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { warning: typeof toast.warning }).warning =
      toastWarning as unknown as typeof toast.warning;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });

      expect(taskPullRequestDetect).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).not.toHaveBeenCalled();
      expect(runsList).not.toHaveBeenCalled();
      expect(toastWarning).toHaveBeenCalledWith("No pull request found", {
        description: "No open GitHub pull request found for odt/task-1.",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.warning = originalToastWarning;
    }
  });

  test("syncPullRequests reports pull request detection errors without rethrowing", async () => {
    const taskPullRequestDetect = mock(async () => {
      throw new Error("gh auth expired");
    });
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    host.runsList = runsList;
    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });

      expect(taskPullRequestDetect).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Failed to detect pull request", {
        description: "gh auth expired",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.error = originalToastError;
    }
  });

  test("syncPullRequests reports missing workspace selection without rethrowing", async () => {
    const taskPullRequestDetect = mock(async () => {
      throw new Error("taskPullRequestDetect should not be called without an active workspace");
    });
    const toastError = mock(() => "");
    const originalTaskPullRequestDetect = host.taskPullRequestDetect;
    const originalToastError = toast.error;
    host.taskPullRequestDetect = taskPullRequestDetect;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: null,
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: null,
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });

      expect(taskPullRequestDetect).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Failed to detect pull request", {
        description: "Select a workspace first.",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = originalTaskPullRequestDetect;
      toast.error = originalToastError;
    }
  });

  test("unlinkPullRequest reports unlink errors without rethrowing", async () => {
    const taskPullRequestUnlink = mock(async () => {
      throw new Error("unlink failed");
    });
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestUnlink: host.taskPullRequestUnlink,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestUnlink = taskPullRequestUnlink;
    host.tasksList = tasksList;
    host.runsList = runsList;
    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.unlinkPullRequest("A");
      });

      expect(taskPullRequestUnlink).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).not.toHaveBeenCalled();
      expect(runsList).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Failed to unlink pull request", {
        description: "unlink failed",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestUnlink = original.taskPullRequestUnlink;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.error = originalToastError;
    }
  });

  test("unlinkPullRequest refreshes tasks after removing a linked pull request", async () => {
    const taskPullRequestUnlink = mock(async () => ({ ok: true }));
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestUnlink: host.taskPullRequestUnlink,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestUnlink = taskPullRequestUnlink;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const originalToastSuccess = toast.success;
    const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { success: typeof toast.success }).success =
      toastSuccess as unknown as typeof toast.success;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.unlinkPullRequest("A");
      });

      expect(taskPullRequestUnlink).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(runsList).toHaveBeenCalledWith("/repo");
      expect(harness.getLatest().tasks[0]?.pullRequest).toBeUndefined();
      expect(toastSuccess).toHaveBeenCalledWith("Pull request unlinked", {
        description: "A",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestUnlink = original.taskPullRequestUnlink;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.success = originalToastSuccess;
    }
  });

  test("unlinkPullRequest tracks only the unlinking task while the request is pending", async () => {
    const unlink = createDeferred<{ ok: boolean }>();
    const taskPullRequestUnlink = mock(async () => unlink.promise);
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestUnlink: host.taskPullRequestUnlink,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestUnlink = taskPullRequestUnlink;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();

      let unlinkPromise: Promise<void> | null = null;
      await harness.run((value) => {
        unlinkPromise = value.unlinkPullRequest("A");
      });

      expect(harness.getLatest().unlinkingPullRequestTaskId).toBe("A");
      expect(harness.getLatest().detectingPullRequestTaskId).toBeNull();
      expect(harness.getLatest().isLoadingTasks).toBe(false);

      await act(async () => {
        unlink.resolve({ ok: true });
        await unlinkPromise;
      });
      await flush();

      expect(harness.getLatest().unlinkingPullRequestTaskId).toBeNull();
    } finally {
      unlink.resolve({ ok: true });
      await harness.unmount();
      host.taskPullRequestUnlink = original.taskPullRequestUnlink;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("createTask trims title before sending mutation", async () => {
    const taskCreate = mock(
      async (_repoPath: string, input: TaskCreateInput): Promise<TaskCard> => ({
        ...makeTask("A", "open"),
        title: input.title,
      }),
    );
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskCreate: host.taskCreate,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskCreate = taskCreate;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    const input: TaskCreateInput = {
      title: "  Ship feature  ",
      issueType: "task",
      aiReviewEnabled: true,
      priority: 2,
      labels: [],
      description: "",
    };

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.createTask(input);
      });

      expect(taskCreate).toHaveBeenCalledWith("/repo", {
        ...input,
        title: "Ship feature",
      });
      expect(tasksList).toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.taskCreate = original.taskCreate;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("createTask throws when no workspace is active even for blank title", async () => {
    const taskCreate = mock(
      async (_repoPath: string, input: TaskCreateInput): Promise<TaskCard> => ({
        ...makeTask("A", "open"),
        title: input.title,
      }),
    );

    const original = {
      taskCreate: host.taskCreate,
    };
    host.taskCreate = taskCreate;

    const harness = createHookHarness({
      activeRepo: null,
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();

      await expect(
        harness.run(async (value) => {
          await value.createTask({
            title: "   ",
            issueType: "task",
            aiReviewEnabled: true,
            priority: 2,
            labels: [],
            description: "",
          });
        }),
      ).rejects.toThrow("Select a workspace first.");

      expect(taskCreate).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.taskCreate = original.taskCreate;
    }
  });

  test("skips refresh when beads check reports unavailable", async () => {
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: false,
        beadsPath: null,
        beadsError: "missing store",
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(tasksList).not.toHaveBeenCalled();
      expect(runsList).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });
});
