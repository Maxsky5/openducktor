import { describe, expect, mock, test } from "bun:test";
import type { PullRequest, TaskPullRequestDetectResult } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRef, type PropsWithChildren, type ReactElement } from "react";
import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import { pullRequestReviewQueryKeys } from "@openducktor/frontend-core/queries/pull-request-review";
import { writeWorkspaceListToQuery } from "@openducktor/frontend-core/queries/workspace";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  createDeferred,
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import type { TaskMutationRunner } from "./task-mutation-runner";
import {
  type TaskPullRequestChatDraftCleanupPort,
  type TaskPullRequestHostPort,
  type TaskPullRequestNotificationPort,
  useTaskPullRequestOperations,
} from "./use-task-pull-request-operations";

const pullRequest: PullRequest = {
  providerId: "github",
  number: 17,
  url: "https://github.com/openai/openducktor/pull/17",
  state: "open",
  createdAt: "2026-07-10T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

type NotificationEvent = {
  level: "success" | "warning" | "error";
  title: string;
  description: string;
};

const createNotificationPort = () => {
  const events: NotificationEvent[] = [];
  const report =
    (level: NotificationEvent["level"]) =>
    (title: string, description: string): void => {
      events.push({ level, title, description });
    };

  return {
    events,
    port: {
      success: report("success"),
      warning: report("warning"),
      error: report("error"),
    },
  } satisfies {
    events: NotificationEvent[];
    port: TaskPullRequestNotificationPort;
  };
};

const createPullRequestHostPort = (
  overrides: Partial<TaskPullRequestHostPort> = {},
): TaskPullRequestHostPort => ({
  detectPullRequest: async () => ({
    outcome: "not_found",
    sourceBranch: "feature/task-1",
    targetBranch: "main",
  }),
  linkMergedPullRequest: async () => createTaskCardFixture({ id: "task-1", pullRequest }),
  unlinkPullRequest: async () => ({ ok: true }),
  ...overrides,
});

type OperationsHarnessOptions = {
  activeRepoPath?: string | null;
  pullRequestHostPort?: TaskPullRequestHostPort;
  runTaskMutation?: TaskMutationRunner["runTaskMutation"];
  taskChatDraftCleanup?: TaskPullRequestChatDraftCleanupPort;
};

const createOperationsHarness = (options: OperationsHarnessOptions = {}) => {
  const queryClient = createClientQueryClient();
  const queryKey = pullRequestReviewQueryKeys.context({
    repoPath: "/repo",
    taskId: "task-1",
    pullRequest: { providerId: "github", number: 7 },
  });
  queryClient.setQueryData(queryKey, { stale: true });
  const refreshTaskData = mock(async () => {});
  const notification = createNotificationPort();
  const pullRequestHostPort = options.pullRequestHostPort ?? createPullRequestHostPort();
  const runTaskMutation =
    options.runTaskMutation ??
    (async (mutationOptions) => {
      await mutationOptions.run("/repo");
    });
  const cleanupEvents: string[] = [];
  const taskChatDraftCleanup: TaskPullRequestChatDraftCleanupPort =
    options.taskChatDraftCleanup ?? {
      runMutation: async ({ mutation }) => {
        cleanupEvents.push("injected cleanup started");
        const result = await mutation();
        cleanupEvents.push("injected cleanup completed");
        return result;
      },
    };
  const useOperations = ({ activeRepoPath }: { activeRepoPath: string | null }) =>
    useTaskPullRequestOperations({
      activeRepoPath,
      activeWorkspaceId: activeRepoPath === "/repo" ? "workspace-1" : "workspace-2",
      tasks: [
        createTaskCardFixture({
          id: "task-1",
          title: activeRepoPath === "/repo" ? "Original task" : "Other task",
        }),
        createTaskCardFixture({ id: "task-2", title: "Second task" }),
      ],
      refreshTaskData,
      runTaskMutation,
      pullRequestHostPort,
      notificationPort: notification.port,
      taskChatDraftCleanup,
    });
  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const initialProps: Parameters<typeof useOperations>[0] = {
    activeRepoPath: options.activeRepoPath === undefined ? "/repo" : options.activeRepoPath,
  };
  const harness = createHookHarness(useOperations, initialProps, { wrapper });

  return {
    notification,
    pullRequestHostPort,
    queryClient,
    queryKey,
    cleanupEvents,
    refreshTaskData,
    harness,
    getLatest: harness.getLatest,
  };
};

const expectReviewQueryInvalidated = (
  queryClient: ReturnType<typeof createClientQueryClient>,
  queryKey: ReturnType<typeof pullRequestReviewQueryKeys.context>,
): void => {
  expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
};

describe("useTaskPullRequestOperations", () => {
  test.each(["merged", "linked", "not_found", "error", "refresh"] as const)(
    "ignores an old %s completion after closure without clearing a fresh request",
    async (outcome) => {
      const old = createDeferred<TaskPullRequestDetectResult>();
      const fresh = createDeferred<TaskPullRequestDetectResult>();
      const refresh = createDeferred<void>();
      const detect = mock(() => (detect.mock.calls.length === 1 ? old.promise : fresh.promise));
      const state = createOperationsHarness({
        pullRequestHostPort: createPullRequestHostPort({ detectPullRequest: detect }),
      });
      const workspace = createWorkspaceRecordFixture();
      writeWorkspaceListToQuery(state.queryClient, [workspace]);
      await state.harness.mount();
      try {
        let oldRequest: Promise<void> | undefined;
        await state.harness.run(() => {
          oldRequest = state.getLatest().syncPullRequests("task-1");
        });
        if (outcome === "refresh") {
          state.refreshTaskData.mockImplementationOnce(() => refresh.promise);
          await state.harness.run(() => old.resolve({ outcome: "linked", pullRequest }));
        }
        await state.harness.run(() => {
          writeWorkspaceListToQuery(state.queryClient, []);
          writeWorkspaceListToQuery(state.queryClient, [workspace]);
        });
        let freshRequest: Promise<void> | undefined;
        await state.harness.run(() => {
          freshRequest = state.getLatest().syncPullRequests("task-1");
        });
        expect(detect).toHaveBeenCalledTimes(2);
        await state.harness.run(async () => {
          if (outcome === "refresh") refresh.resolve();
          else if (outcome === "error") old.reject(new Error("old detection failed"));
          else if (outcome === "not_found") {
            old.resolve({ outcome, sourceBranch: "old", targetBranch: "main" });
          } else old.resolve({ outcome, pullRequest });
          await oldRequest;
        });
        expect(state.getLatest().detectingPullRequestTaskIds).toEqual(new Set(["task-1"]));
        expect(state.getLatest().pendingMergedPullRequest).toBeNull();
        expect(state.notification.events).toEqual([]);
        expect(state.refreshTaskData).toHaveBeenCalledTimes(outcome === "refresh" ? 1 : 0);
        await state.harness.run(async () => {
          fresh.resolve({ outcome: "merged", pullRequest });
          await freshRequest;
        });
        expect(state.getLatest().pendingMergedPullRequest?.taskId).toBe("task-1");
      } finally {
        await state.harness.unmount();
      }
    },
  );

  test.each(["/repo", "/other-repo"])(
    "drops a removed workspace's confirmations while %s is active",
    async (activeRepoPath) => {
      const state = createOperationsHarness({
        pullRequestHostPort: createPullRequestHostPort({
          detectPullRequest: async () => ({ outcome: "merged", pullRequest }),
        }),
      });
      const original = createWorkspaceRecordFixture();
      const other = createWorkspaceRecordFixture({
        workspaceId: "workspace-2",
        repoPath: "/other-repo",
      });
      writeWorkspaceListToQuery(state.queryClient, [original, other]);
      await state.harness.mount();
      try {
        await state.harness.run(() => state.getLatest().syncPullRequests("task-1"));
        await state.harness.update({ activeRepoPath: "/other-repo" });
        await state.harness.run(() => state.getLatest().syncPullRequests("task-2"));
        await state.harness.update({ activeRepoPath });
        await state.harness.run(() => writeWorkspaceListToQuery(state.queryClient, [other]));
        await state.harness.run(() =>
          writeWorkspaceListToQuery(state.queryClient, [
            { ...original, workspaceId: "replacement" },
            other,
          ]),
        );
        await state.harness.update({ activeRepoPath: "/repo" });
        expect(state.getLatest().pendingMergedPullRequest).toBeNull();
        await state.harness.update({ activeRepoPath: "/other-repo" });
        expect(state.getLatest().pendingMergedPullRequest?.taskId).toBe("task-2");
      } finally {
        await state.harness.unmount();
      }
    },
  );

  test.each(["link", "unlink"] as const)(
    "keeps an admitted %s guarded through closure and reopening",
    async (kind) => {
      const write = createDeferred<void>();
      const request = mock(() => write.promise);
      const state = createOperationsHarness({
        pullRequestHostPort: createPullRequestHostPort({
          detectPullRequest: async () => ({ outcome: "merged", pullRequest }),
          linkMergedPullRequest: () => request().then(() => createTaskCardFixture()),
          unlinkPullRequest: () => request().then(() => ({ ok: true })),
        }),
      });
      const workspace = createWorkspaceRecordFixture();
      writeWorkspaceListToQuery(state.queryClient, [workspace]);
      await state.harness.mount();
      try {
        const run = () =>
          kind === "unlink"
            ? state.getLatest().unlinkPullRequest("task-1")
            : state.getLatest().linkMergedPullRequest();
        if (kind !== "unlink")
          await state.harness.run(() => state.getLatest().syncPullRequests("task-1"));
        let pending: Promise<void> | undefined;
        await state.harness.run(() => {
          pending = run();
        });
        await state.harness.run(() => writeWorkspaceListToQuery(state.queryClient, []));
        await state.harness.run(() => writeWorkspaceListToQuery(state.queryClient, [workspace]));
        await state.harness.run(async () => {
          state.getLatest().cancelLinkMergedPullRequest();
          await run();
          await state.getLatest().syncPullRequests("task-1");
        });
        expect(request).toHaveBeenCalledTimes(1);
        if (kind === "unlink")
          expect(state.getLatest().unlinkingPullRequestTaskIds.has("task-1")).toBe(true);
        else expect(state.getLatest().linkingMergedPullRequestTaskId).toBe("task-1");
        await state.harness.run(async () => {
          if (kind === "link") write.reject(new Error("link failed"));
          else write.resolve();
          await pending;
        });
        expect(state.getLatest().pendingMergedPullRequest).toBeNull();
        expect(state.getLatest().linkingMergedPullRequestTaskId).toBeNull();
        expect(state.getLatest().unlinkingPullRequestTaskIds.size).toBe(0);
      } finally {
        await state.harness.unmount();
      }
    },
  );

  test.each(["detect", "unlink"] as const)(
    "keeps every concurrent %s operation busy in its own workspace until completion",
    async (kind) => {
      const first = createDeferred<void>();
      const second = createDeferred<void>();
      const request = mock(async (_repoPath: string, taskId: string) => {
        await (taskId === "task-1" ? first.promise : second.promise);
      });
      const testHarness = createOperationsHarness({
        pullRequestHostPort: createPullRequestHostPort({
          detectPullRequest: async (repoPath, taskId) => {
            await request(repoPath, taskId);
            return { outcome: "not_found", sourceBranch: taskId, targetBranch: "main" };
          },
          unlinkPullRequest: async (repoPath, taskId) => {
            await request(repoPath, taskId);
            return { ok: true };
          },
        }),
      });
      const busyTaskIds = () =>
        kind === "detect"
          ? testHarness.getLatest().detectingPullRequestTaskIds
          : testHarness.getLatest().unlinkingPullRequestTaskIds;
      const run = (taskId: string) =>
        kind === "detect"
          ? testHarness.getLatest().syncPullRequests(taskId)
          : testHarness.getLatest().unlinkPullRequest(taskId);
      await testHarness.harness.mount();
      try {
        let firstPromise: Promise<void> | undefined;
        let secondPromise: Promise<void> | undefined;
        await testHarness.harness.run(() => {
          firstPromise = run("task-1");
          secondPromise = run("task-2");
        });
        expect(busyTaskIds()).toEqual(new Set(["task-1", "task-2"]));
        await testHarness.harness.update({ activeRepoPath: "/other-repo" });
        expect(busyTaskIds()).toEqual(new Set());
        await testHarness.harness.update({ activeRepoPath: "/repo" });
        expect(busyTaskIds()).toEqual(new Set(["task-1", "task-2"]));
        await testHarness.harness.run(async () => {
          first.resolve();
          await firstPromise;
        });
        expect(busyTaskIds()).toEqual(new Set(["task-2"]));
        await testHarness.harness.run(async () => {
          second.resolve();
          await secondPromise;
        });
        expect(busyTaskIds()).toEqual(new Set());
        expect(request).toHaveBeenCalledTimes(2);
      } finally {
        await testHarness.harness.unmount();
      }
    },
  );

  test("refreshes the original task and review cache when linking finishes in an inactive repository", async () => {
    const detection = createDeferred<TaskPullRequestDetectResult>();
    const detectPullRequest = mock(() => detection.promise);
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({ detectPullRequest }),
    });
    await testHarness.harness.mount();

    try {
      let detectionPromise: Promise<void> | undefined;
      await testHarness.harness.run(() => {
        detectionPromise = testHarness.getLatest().syncPullRequests("task-1");
      });
      await testHarness.harness.update({ activeRepoPath: "/other-repo" });
      await testHarness.harness.run(async () => {
        detection.resolve({ outcome: "linked", pullRequest });
        await detectionPromise;
      });

      expect(detectPullRequest).toHaveBeenCalledWith("/repo", "task-1");
      expect(testHarness.refreshTaskData).toHaveBeenCalledWith("/repo", "task-1");
      expectReviewQueryInvalidated(testHarness.queryClient, testHarness.queryKey);
      expect(testHarness.notification.events).toEqual([
        {
          level: "success",
          title: "Pull request linked",
          description: "PR #17 for task-1 (/repo).",
        },
      ]);
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("links a detected merged pull request through the injected cleanup and invalidates CI review data", async () => {
    const operationEvents: string[] = [];
    const linkMergedPullRequest = mock(async () => {
      operationEvents.push("host link");
      return createTaskCardFixture({ id: "task-1", pullRequest });
    });
    const taskChatDraftCleanup: TaskPullRequestChatDraftCleanupPort = {
      runMutation: async ({ mutation }) => {
        operationEvents.push("injected cleanup started");
        const result = await mutation();
        operationEvents.push("injected cleanup completed");
        return result;
      },
    };
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({
        detectPullRequest: async () => ({ outcome: "merged", pullRequest }),
        linkMergedPullRequest,
      }),
      taskChatDraftCleanup,
    });
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));
      await testHarness.harness.run(() => testHarness.getLatest().linkMergedPullRequest());

      expect(linkMergedPullRequest).toHaveBeenCalledWith("/repo", "task-1", pullRequest);
      expect(operationEvents).toEqual([
        "injected cleanup started",
        "host link",
        "injected cleanup completed",
      ]);
      expectReviewQueryInvalidated(testHarness.queryClient, testHarness.queryKey);
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("restores unlink progress after a workspace round trip and invalidates CI review data", async () => {
    const unlinkResult = createDeferred<{ ok: boolean }>();
    const unlinkPullRequest = mock(() => unlinkResult.promise);
    const runTaskMutation = mock(
      async (options: Parameters<TaskMutationRunner["runTaskMutation"]>[0]) => {
        await options.run("/repo");
      },
    );
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({ unlinkPullRequest }),
      runTaskMutation,
    });
    await testHarness.harness.mount();

    try {
      let unlinkPromise: Promise<void> | undefined;
      await testHarness.harness.run(() => {
        unlinkPromise = testHarness.getLatest().unlinkPullRequest("task-1");
      });
      expect(testHarness.getLatest().unlinkingPullRequestTaskIds).toEqual(new Set(["task-1"]));
      await testHarness.harness.update({ activeRepoPath: "/other-repo" });
      expect(testHarness.getLatest().unlinkingPullRequestTaskIds).toEqual(new Set());
      await testHarness.harness.update({ activeRepoPath: "/repo" });
      expect(testHarness.getLatest().unlinkingPullRequestTaskIds).toEqual(new Set(["task-1"]));
      await testHarness.harness.run(async () => {
        unlinkResult.resolve({ ok: true });
        await unlinkPromise;
      });

      expect(unlinkPullRequest).toHaveBeenCalledWith("/repo", "task-1");
      expectReviewQueryInvalidated(testHarness.queryClient, testHarness.queryKey);
      expect(testHarness.getLatest().unlinkingPullRequestTaskIds).toEqual(new Set());
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("warns when detection finds no pull request after the repository becomes inactive", async () => {
    const detection = createDeferred<TaskPullRequestDetectResult>();
    const linkMergedPullRequest = mock(async () =>
      createTaskCardFixture({ id: "task-1", pullRequest }),
    );
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({
        detectPullRequest: () => detection.promise,
        linkMergedPullRequest,
      }),
    });
    await testHarness.harness.mount();

    try {
      let detectionPromise: Promise<void> | undefined;
      await testHarness.harness.run(() => {
        detectionPromise = testHarness.getLatest().syncPullRequests("task-1");
      });
      await testHarness.harness.update({ activeRepoPath: null });
      await testHarness.harness.run(async () => {
        detection.resolve({
          outcome: "not_found",
          sourceBranch: "feature/task-1",
          targetBranch: "main",
        });
        await detectionPromise;
      });

      expect(testHarness.getLatest().pendingMergedPullRequest).toBeNull();
      expect(linkMergedPullRequest).not.toHaveBeenCalled();
      expect(testHarness.notification.events).toEqual([
        {
          level: "warning",
          title: "No pull request found",
          description: "No open pull request found for task-1 on feature/task-1 (/repo).",
        },
      ]);
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("reports pull request detection failures without rethrowing to the UI handler", async () => {
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({
        detectPullRequest: async () => {
          throw new Error("GitHub is unavailable");
        },
      }),
    });
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));

      expect(testHarness.getLatest().detectingPullRequestTaskIds).toEqual(new Set());
      expect(testHarness.notification.events).toEqual([
        {
          level: "error",
          title: "Failed to detect pull request",
          description: "task-1 (/repo): GitHub is unavailable",
        },
      ]);
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("defers a background merged confirmation until its repository is active", async () => {
    const detection = createDeferred<TaskPullRequestDetectResult>();
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({
        detectPullRequest: () => detection.promise,
      }),
    });
    await testHarness.harness.mount();

    try {
      let detectionPromise: Promise<void> | null = null;
      await testHarness.harness.run(() => {
        detectionPromise = testHarness.getLatest().syncPullRequests("task-1");
      });
      await testHarness.harness.update({ activeRepoPath: "/other-repo" });
      detection.resolve({ outcome: "merged", pullRequest });
      await testHarness.harness.run(async () => {
        await detectionPromise;
      });

      expect(testHarness.getLatest().pendingMergedPullRequest).toBeNull();
      expect(testHarness.getLatest().detectingPullRequestTaskIds).toEqual(new Set());
      expect(testHarness.notification.events).toEqual([
        {
          level: "warning",
          title: "Merged pull request found",
          description: "PR #17 for task-1. Switch to /repo to confirm linking it.",
        },
      ]);
      await testHarness.harness.update({ activeRepoPath: "/repo" });
      expect(testHarness.getLatest().pendingMergedPullRequest).toEqual({
        taskId: "task-1",
        taskTitle: "Original task",
        pullRequest,
      });
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("keeps merged confirmations separate for matching task IDs in different repositories", async () => {
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({
        detectPullRequest: async () => ({ outcome: "merged", pullRequest }),
      }),
    });
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));
      expect(testHarness.getLatest().pendingMergedPullRequest).not.toBeNull();

      await testHarness.harness.update({ activeRepoPath: "/other-repo" });
      expect(testHarness.getLatest().pendingMergedPullRequest).toBeNull();
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));
      await testHarness.harness.run(() => testHarness.getLatest().cancelLinkMergedPullRequest());
      await testHarness.harness.update({ activeRepoPath: "/repo" });
      expect(testHarness.getLatest().pendingMergedPullRequest).toEqual({
        taskId: "task-1",
        taskTitle: "Original task",
        pullRequest,
      });
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("restores concurrent detection progress and does not clear another repository on completion", async () => {
    const firstDetection = createDeferred<TaskPullRequestDetectResult>();
    const secondDetection = createDeferred<TaskPullRequestDetectResult>();
    const detectPullRequest = mock((repoPath: string) =>
      repoPath === "/repo" ? firstDetection.promise : secondDetection.promise,
    );
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({ detectPullRequest }),
    });
    await testHarness.harness.mount();

    try {
      let firstPromise: Promise<void> | undefined;
      let secondPromise: Promise<void> | undefined;
      await testHarness.harness.run(() => {
        firstPromise = testHarness.getLatest().syncPullRequests("task-1");
      });
      await testHarness.harness.update({ activeRepoPath: "/other-repo" });
      expect(testHarness.getLatest().detectingPullRequestTaskIds).toEqual(new Set());
      await testHarness.harness.run(() => {
        secondPromise = testHarness.getLatest().syncPullRequests("task-1");
      });
      await testHarness.harness.update({ activeRepoPath: "/repo" });
      expect(testHarness.getLatest().detectingPullRequestTaskIds).toEqual(new Set(["task-1"]));
      await testHarness.harness.run(() => {
        void testHarness.getLatest().syncPullRequests("task-1");
      });
      expect(detectPullRequest).toHaveBeenCalledTimes(2);
      await testHarness.harness.update({ activeRepoPath: "/other-repo" });
      await testHarness.harness.run(async () => {
        firstDetection.resolve({ outcome: "merged", pullRequest });
        await firstPromise;
      });
      expect(testHarness.getLatest().detectingPullRequestTaskIds).toEqual(new Set(["task-1"]));
      expect(testHarness.getLatest().pendingMergedPullRequest).toBeNull();
      await testHarness.harness.run(async () => {
        secondDetection.resolve({ outcome: "merged", pullRequest });
        await secondPromise;
      });
      expect(testHarness.getLatest().detectingPullRequestTaskIds).toEqual(new Set());
      expect(testHarness.getLatest().pendingMergedPullRequest?.taskId).toBe("task-1");
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("keeps the shown merged confirmation when another task finishes detection", async () => {
    const firstDetection = createDeferred<TaskPullRequestDetectResult>();
    const secondDetection = createDeferred<TaskPullRequestDetectResult>();
    const linkResult = createDeferred<ReturnType<typeof createTaskCardFixture>>();
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({
        detectPullRequest: (_repoPath, taskId) =>
          taskId === "task-1" ? firstDetection.promise : secondDetection.promise,
        linkMergedPullRequest: () => linkResult.promise,
      }),
    });
    await testHarness.harness.mount();

    try {
      let firstPromise: Promise<void> | undefined;
      let secondPromise: Promise<void> | undefined;
      let linkPromise: Promise<void> | undefined;
      await testHarness.harness.run(() => {
        firstPromise = testHarness.getLatest().syncPullRequests("task-1");
        secondPromise = testHarness.getLatest().syncPullRequests("task-2");
      });
      await testHarness.harness.run(async () => {
        secondDetection.resolve({ outcome: "merged", pullRequest });
        await secondPromise;
      });
      expect(testHarness.getLatest().pendingMergedPullRequest?.taskId).toBe("task-2");
      await testHarness.harness.run(() => {
        linkPromise = testHarness.getLatest().linkMergedPullRequest();
      });
      await testHarness.harness.run(async () => {
        firstDetection.resolve({ outcome: "merged", pullRequest });
        await firstPromise;
      });
      expect(testHarness.getLatest().pendingMergedPullRequest?.taskId).toBe("task-2");
      expect(testHarness.getLatest().linkingMergedPullRequestTaskId).toBe("task-2");
      await testHarness.harness.run(async () => {
        linkResult.resolve(createTaskCardFixture({ id: "task-2", pullRequest }));
        await linkPromise;
      });
      expect(testHarness.getLatest().pendingMergedPullRequest?.taskId).toBe("task-1");
      await testHarness.harness.run(() => testHarness.getLatest().cancelLinkMergedPullRequest());
      expect(testHarness.getLatest().pendingMergedPullRequest).toBeNull();
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("reports link failures and clears the linking state", async () => {
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({
        detectPullRequest: async () => ({ outcome: "merged", pullRequest }),
        linkMergedPullRequest: async () => {
          throw new Error("Merge cleanup failed");
        },
      }),
    });
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));
      await testHarness.harness.run(() => testHarness.getLatest().linkMergedPullRequest());

      expect(testHarness.getLatest().linkingMergedPullRequestTaskId).toBeNull();
      expect(testHarness.notification.events).toContainEqual({
        level: "error",
        title: "Failed to link merged pull request",
        description: "task-1 (/repo): Merge cleanup failed",
      });
      expect(testHarness.getLatest().pendingMergedPullRequest?.taskId).toBe("task-1");
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("delegates unlink failures to the mutation runner and clears unlinking state", async () => {
    const unlinkFailure = new Error("GitHub is unavailable");
    const mutationFailureTitle = createRef<string>();
    const runTaskMutation: TaskMutationRunner["runTaskMutation"] = async (options) => {
      mutationFailureTitle.current = options.failureTitle;
      await options.run("/repo");
      throw unlinkFailure;
    };
    const testHarness = createOperationsHarness({
      runTaskMutation,
      pullRequestHostPort: createPullRequestHostPort({
        unlinkPullRequest: async () => {
          throw unlinkFailure;
        },
      }),
    });
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().unlinkPullRequest("task-1"));

      expect(mutationFailureTitle.current).toBe("Failed to unlink pull request");
      expect(testHarness.getLatest().unlinkingPullRequestTaskIds).toEqual(new Set());
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("keeps cancel and duplicate confirmation disabled across a workspace round trip during linking", async () => {
    const linkResult = createDeferred<ReturnType<typeof createTaskCardFixture>>();
    const otherLinkResult = createDeferred<ReturnType<typeof createTaskCardFixture>>();
    const linkMergedPullRequest = mock((repoPath: string) =>
      repoPath === "/repo" ? linkResult.promise : otherLinkResult.promise,
    );
    const cleanupInputs: { repoPath: string; workspaceId: string | null }[] = [];
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({
        detectPullRequest: async () => ({ outcome: "merged", pullRequest }),
        linkMergedPullRequest,
      }),
      taskChatDraftCleanup: {
        runMutation: async (input) => {
          cleanupInputs.push({ repoPath: input.repoPath, workspaceId: input.workspaceId });
          return input.mutation();
        },
      },
    });
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));

      let linkPromise: Promise<void> | null = null;
      await testHarness.harness.run(() => {
        linkPromise = testHarness.getLatest().linkMergedPullRequest();
        testHarness.getLatest().cancelLinkMergedPullRequest();
      });

      expect(testHarness.getLatest().pendingMergedPullRequest).not.toBeNull();
      await testHarness.harness.update({ activeRepoPath: "/other-repo" });
      expect(testHarness.getLatest().linkingMergedPullRequestTaskId).toBeNull();
      expect(testHarness.getLatest().pendingMergedPullRequest).toBeNull();
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));
      let otherLinkPromise: Promise<void> | undefined;
      await testHarness.harness.run(() => {
        otherLinkPromise = testHarness.getLatest().linkMergedPullRequest();
      });
      await testHarness.harness.update({ activeRepoPath: "/repo" });
      expect(testHarness.getLatest().linkingMergedPullRequestTaskId).toBe("task-1");
      await testHarness.harness.run(() => {
        testHarness.getLatest().cancelLinkMergedPullRequest();
        void testHarness.getLatest().linkMergedPullRequest();
      });
      expect(testHarness.getLatest().pendingMergedPullRequest?.taskId).toBe("task-1");
      expect(linkMergedPullRequest).toHaveBeenCalledTimes(2);
      expect(cleanupInputs).toEqual([
        { repoPath: "/repo", workspaceId: "workspace-1" },
        { repoPath: "/other-repo", workspaceId: "workspace-2" },
      ]);
      await testHarness.harness.update({ activeRepoPath: "/other-repo" });
      await testHarness.harness.run(async () => {
        linkResult.resolve(createTaskCardFixture({ id: "task-1", pullRequest }));
        await linkPromise;
      });
      expect(testHarness.refreshTaskData).toHaveBeenCalledWith("/repo", "task-1");
      expect(testHarness.getLatest().linkingMergedPullRequestTaskId).toBe("task-1");
      await testHarness.harness.run(() => testHarness.getLatest().cancelLinkMergedPullRequest());
      expect(testHarness.getLatest().pendingMergedPullRequest?.taskId).toBe("task-1");
      await testHarness.harness.run(async () => {
        otherLinkResult.resolve(createTaskCardFixture({ id: "task-1", pullRequest }));
        await otherLinkPromise;
      });
      expect(testHarness.refreshTaskData).toHaveBeenCalledWith("/other-repo", "task-1");
      await testHarness.harness.update({ activeRepoPath: "/repo" });
      expect(testHarness.getLatest().pendingMergedPullRequest).toBeNull();
      expect(testHarness.getLatest().linkingMergedPullRequestTaskId).toBeNull();
    } finally {
      await testHarness.harness.unmount();
    }
  });
});
