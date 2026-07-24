import { describe, expect, mock, test } from "bun:test";
import type { PullRequest, TaskPullRequestDetectResult } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { createQueryClient } from "@/lib/query-client";
import { pullRequestReviewQueryKeys } from "@/state/queries/pull-request-review";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred, createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
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

const createNotificationPort = (): {
  events: NotificationEvent[];
  port: TaskPullRequestNotificationPort;
} => {
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
  const queryClient = createQueryClient();
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
  const Harness = ({ activeRepoPath }: { activeRepoPath: string | null }) => {
    const operations = useTaskPullRequestOperations({
      activeRepoPath,
      activeWorkspaceId: "workspace-1",
      refreshTaskData,
      runTaskMutation,
      pullRequestHostPort,
      notificationPort: notification.port,
      taskChatDraftCleanup,
    });
    return operations;
  };
  let latest: ReturnType<typeof useTaskPullRequestOperations> | null = null;
  const Hook = (props: { activeRepoPath: string | null }) => {
    latest = Harness(props);
    return null;
  };
  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const harness = createHookHarness(
    Hook,
    { activeRepoPath: options.activeRepoPath ?? "/repo" },
    { wrapper },
  );

  return {
    notification,
    pullRequestHostPort,
    queryClient,
    queryKey,
    cleanupEvents,
    refreshTaskData,
    harness,
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook is not mounted.");
      }
      return latest;
    },
  };
};

const expectReviewQueryInvalidated = (
  queryClient: ReturnType<typeof createQueryClient>,
  queryKey: ReturnType<typeof pullRequestReviewQueryKeys.context>,
): void => {
  expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
};

describe("useTaskPullRequestOperations", () => {
  test("detects and invalidates CI review data after linking an open pull request", async () => {
    const detectPullRequest = mock(async () => ({ outcome: "linked" as const, pullRequest }));
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({ detectPullRequest }),
    });
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));

      expect(detectPullRequest).toHaveBeenCalledWith("/repo", "task-1");
      expect(testHarness.refreshTaskData).toHaveBeenCalledWith("/repo", "task-1");
      expectReviewQueryInvalidated(testHarness.queryClient, testHarness.queryKey);
      expect(testHarness.notification.events).toEqual([
        { level: "success", title: "Pull request linked", description: "PR #17" },
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

  test("unlinks a pull request and invalidates CI review data", async () => {
    const unlinkPullRequest = mock(async () => ({ ok: true }));
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({ unlinkPullRequest }),
    });
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().unlinkPullRequest("task-1"));

      expect(unlinkPullRequest).toHaveBeenCalledWith("/repo", "task-1");
      expectReviewQueryInvalidated(testHarness.queryClient, testHarness.queryKey);
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("warns and does not link when pull request detection finds no pull request", async () => {
    const linkMergedPullRequest = mock(async () =>
      createTaskCardFixture({ id: "task-1", pullRequest }),
    );
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({ linkMergedPullRequest }),
    });
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));

      expect(testHarness.getLatest().pendingMergedPullRequest).toBeNull();
      expect(linkMergedPullRequest).not.toHaveBeenCalled();
      expect(testHarness.notification.events).toEqual([
        {
          level: "warning",
          title: "No pull request found",
          description: "No open GitHub pull request found for feature/task-1.",
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

      expect(testHarness.getLatest().detectingPullRequestTaskId).toBeNull();
      expect(testHarness.notification.events).toEqual([
        {
          level: "error",
          title: "Failed to detect pull request",
          description: "GitHub is unavailable",
        },
      ]);
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("ignores merged pull request detection that completes after a repository switch", async () => {
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
      expect(testHarness.getLatest().detectingPullRequestTaskId).toBeNull();
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("invalidates merged pull request state on repository switch and reports expired links", async () => {
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
      await testHarness.harness.run(() => testHarness.getLatest().linkMergedPullRequest());

      expect(testHarness.getLatest().pendingMergedPullRequest).toBeNull();
      expect(testHarness.notification.events).toContainEqual({
        level: "error",
        title: "Merged pull request state expired",
        description: "Re-run pull request detection and try again.",
      });
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
        description: "Merge cleanup failed",
      });
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("delegates unlink failures to the mutation runner and clears unlinking state", async () => {
    const unlinkFailure = new Error("GitHub is unavailable");
    const mutationFailure = { title: null as string | null };
    const runTaskMutation: TaskMutationRunner["runTaskMutation"] = async (options) => {
      mutationFailure.title = options.failureTitle;
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

      expect(mutationFailure.title).toBe("Failed to unlink pull request");
      expect(testHarness.getLatest().unlinkingPullRequestTaskId).toBeNull();
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("does not cancel a merged pull request while linking starts in the same turn", async () => {
    const linkResult = createDeferred<ReturnType<typeof createTaskCardFixture>>();
    const testHarness = createOperationsHarness({
      pullRequestHostPort: createPullRequestHostPort({
        detectPullRequest: async () => ({ outcome: "merged", pullRequest }),
        linkMergedPullRequest: () => linkResult.promise,
      }),
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
      await testHarness.harness.run(async () => {
        linkResult.resolve(createTaskCardFixture({ id: "task-1", pullRequest }));
        await linkPromise;
      });
    } finally {
      await testHarness.harness.unmount();
    }
  });
});
