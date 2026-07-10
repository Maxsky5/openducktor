import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { createQueryClient } from "@/lib/query-client";
import { pullRequestReviewQueryKeys } from "@/state/queries/pull-request-review";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { host } from "../shared/host";
import type { TaskMutationRunner } from "./task-mutation-runner";
import { useTaskPullRequestOperations } from "./use-task-pull-request-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const pullRequest: PullRequest = {
  providerId: "github",
  number: 17,
  url: "https://github.com/openai/openducktor/pull/17",
  state: "open",
  createdAt: "2026-07-10T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

const originalHost = {
  taskPullRequestDetect: host.taskPullRequestDetect,
  taskPullRequestLinkMerged: host.taskPullRequestLinkMerged,
  taskPullRequestUnlink: host.taskPullRequestUnlink,
};

afterEach(() => {
  host.taskPullRequestDetect = originalHost.taskPullRequestDetect;
  host.taskPullRequestLinkMerged = originalHost.taskPullRequestLinkMerged;
  host.taskPullRequestUnlink = originalHost.taskPullRequestUnlink;
});

const createOperationsHarness = () => {
  const queryClient = createQueryClient();
  const queryKey = pullRequestReviewQueryKeys.context({
    repoPath: "/repo",
    taskId: "task-1",
    pullRequest: { providerId: "github", number: 7 },
  });
  queryClient.setQueryData(queryKey, { stale: true });
  const refreshTaskData = mock(async () => {});
  const runTaskMutation: TaskMutationRunner["runTaskMutation"] = async (options) => {
    await options.run("/repo");
  };
  const Harness = () => {
    const operations = useTaskPullRequestOperations({
      activeRepoPath: "/repo",
      activeWorkspaceId: null,
      refreshTaskData,
      runTaskMutation,
    });
    return operations;
  };
  let latest: ReturnType<typeof useTaskPullRequestOperations> | null = null;
  const Hook = () => {
    latest = Harness();
    return null;
  };
  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const harness = createHookHarness(Hook, {}, { wrapper });

  return {
    queryClient,
    queryKey,
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
  test("invalidates CI review data after detecting and linking a pull request", async () => {
    host.taskPullRequestDetect = mock(async () => ({ outcome: "linked" as const, pullRequest }));
    const testHarness = createOperationsHarness();
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));

      expectReviewQueryInvalidated(testHarness.queryClient, testHarness.queryKey);
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("invalidates CI review data after explicitly linking a merged pull request", async () => {
    host.taskPullRequestDetect = mock(async () => ({ outcome: "merged" as const, pullRequest }));
    host.taskPullRequestLinkMerged = mock(async () =>
      createTaskCardFixture({ id: "task-1", pullRequest }),
    );
    const testHarness = createOperationsHarness();
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().syncPullRequests("task-1"));
      await testHarness.harness.run(() => testHarness.getLatest().linkMergedPullRequest());

      expectReviewQueryInvalidated(testHarness.queryClient, testHarness.queryKey);
    } finally {
      await testHarness.harness.unmount();
    }
  });

  test("invalidates CI review data after unlinking a pull request", async () => {
    host.taskPullRequestUnlink = mock(async () => ({ ok: true }));
    const testHarness = createOperationsHarness();
    await testHarness.harness.mount();

    try {
      await testHarness.harness.run(() => testHarness.getLatest().unlinkPullRequest("task-1"));

      expectReviewQueryInvalidated(testHarness.queryClient, testHarness.queryKey);
    } finally {
      await testHarness.harness.unmount();
    }
  });
});
