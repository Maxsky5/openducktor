import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot, TaskCard } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { documentQueryKeys } from "./documents";
import { refreshRepoTaskViewsAfterMutation, refreshRepoTaskViewsFromQuery } from "./task-view-sync";
import {
  invalidateRepoTaskQueries,
  loadRepoTaskDataFromQuery,
  refetchActiveKanbanQueries,
  refreshCachedKanbanQueries,
  repoTaskDataQueryOptions,
  taskQueryKeys,
} from "./tasks";
import { settingsSnapshotQueryOptions, workspaceQueryKeys } from "./workspace";

const DONE_VISIBLE_DAYS = 1;

const settingsSnapshotFixture: SettingsSnapshot = createSettingsSnapshotFixture({
  kanban: { doneVisibleDays: DONE_VISIBLE_DAYS },
});

const createDeferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return {
    promise,
    resolve: (value: T | PromiseLike<T>) => {
      if (!resolve) {
        throw new Error("Deferred resolver unavailable");
      }
      resolve(value);
    },
  };
};

const waitForMockCall = async (hasCall: () => boolean, remainingAttempts = 10): Promise<void> => {
  if (hasCall()) {
    return;
  }
  if (remainingAttempts <= 0) {
    throw new Error("Expected mock call did not happen.");
  }
  await Promise.resolve();
  await waitForMockCall(hasCall, remainingAttempts - 1);
};

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  status: "in_progress",
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
  updatedAt: "2026-03-22T12:00:00.000Z",
  createdAt: "2026-03-22T12:00:00.000Z",
};

describe("tasks query cache helpers", () => {
  const originalTasksList = host.tasksList;
  const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
  const originalTaskDocumentGetFresh = host.taskDocumentGetFresh;

  afterEach(() => {
    host.tasksList = originalTasksList;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    host.taskDocumentGetFresh = originalTaskDocumentGetFresh;
  });

  test("canonical repo task-data query loads visible board tasks", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);

    host.tasksList = tasksList;

    const repoTaskData = await queryClient.fetchQuery(
      repoTaskDataQueryOptions("/repo", DONE_VISIBLE_DAYS),
    );

    expect(repoTaskData.tasks).toEqual([taskFixture]);
    expect(tasksList).toHaveBeenCalledTimes(1);
    expect(tasksList).toHaveBeenCalledWith("/repo", DONE_VISIBLE_DAYS);
  });

  test("loadRepoTaskDataFromQuery prepopulates visible tasks cache", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);

    host.tasksList = tasksList;

    const repoTaskData = await loadRepoTaskDataFromQuery(queryClient, "/repo", DONE_VISIBLE_DAYS);

    expect(repoTaskData.tasks).toEqual([taskFixture]);
    expect(tasksList).toHaveBeenCalledWith("/repo", DONE_VISIBLE_DAYS);
  });

  test("refetchActiveKanbanQueries refreshes only active kanban queries for the target repo", async () => {
    const queryClient = new QueryClient();
    let repoACallCount = 0;
    let repoBCallCount = 0;
    const tasksList = mock(
      async (repoPath: string, doneVisibleDays?: number): Promise<TaskCard[]> => {
        if (doneVisibleDays !== DONE_VISIBLE_DAYS) {
          throw new Error(`Unexpected doneVisibleDays: ${doneVisibleDays}`);
        }

        if (repoPath === "/repo-a") {
          repoACallCount += 1;
          return [
            {
              ...taskFixture,
              id: `repo-a-${repoACallCount}`,
              title: `repo-a-${repoACallCount}`,
            },
          ];
        }

        if (repoPath === "/repo-b") {
          repoBCallCount += 1;
          return [
            {
              ...taskFixture,
              id: `repo-b-${repoBCallCount}`,
              title: `repo-b-${repoBCallCount}`,
            },
          ];
        }

        throw new Error(`Unexpected repo path: ${repoPath}`);
      },
    );

    host.tasksList = tasksList;

    const repoAObserver = new QueryObserver(queryClient, repoTaskDataQueryOptions("/repo-a", 1));
    const repoBObserver = new QueryObserver(queryClient, repoTaskDataQueryOptions("/repo-b", 1));
    const unsubscribeRepoA = repoAObserver.subscribe(() => {});
    const unsubscribeRepoB = repoBObserver.subscribe(() => {});

    try {
      await repoAObserver.refetch();
      await repoBObserver.refetch();
      const initialRepoBTaskId = queryClient.getQueryData<{ tasks: TaskCard[] }>(
        taskQueryKeys.kanbanData("/repo-b", 1),
      )?.tasks[0]?.id;
      tasksList.mockClear();

      await invalidateRepoTaskQueries(queryClient, "/repo-a");

      expect(queryClient.getQueryState(taskQueryKeys.kanbanData("/repo-a", 1))?.isInvalidated).toBe(
        true,
      );
      expect(queryClient.getQueryState(taskQueryKeys.kanbanData("/repo-b", 1))?.isInvalidated).toBe(
        false,
      );

      await refetchActiveKanbanQueries(queryClient, "/repo-a");

      expect(tasksList).toHaveBeenCalledTimes(1);
      expect(tasksList).toHaveBeenCalledWith("/repo-a", 1);
      expect(
        queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo-a", 1))
          ?.tasks[0]?.id,
      ).toBe("repo-a-2");
      expect(
        queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo-b", 1))
          ?.tasks[0]?.id,
      ).toBe(initialRepoBTaskId);
      expect(
        queryClient.getQueryState(taskQueryKeys.kanbanData("/repo-a", 1))?.isInvalidated ?? false,
      ).toBe(false);
    } finally {
      unsubscribeRepoA();
      unsubscribeRepoB();
    }
  });

  test("inactive kanban queries stay invalidated until they become active again", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);
    host.tasksList = tasksList;

    queryClient.setQueryData(taskQueryKeys.repoData("/repo", DONE_VISIBLE_DAYS), {
      tasks: [taskFixture],
    });

    await invalidateRepoTaskQueries(queryClient, "/repo");
    tasksList.mockClear();

    await refetchActiveKanbanQueries(queryClient, "/repo");

    expect(tasksList).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS))
        ?.isInvalidated,
    ).toBe(true);
  });

  test("refreshCachedKanbanQueries refreshes cached kanban queries even without prior invalidation", async () => {
    const queryClient = new QueryClient();
    let currentStatus: TaskCard["status"] = "ready_for_dev";
    const tasksList = mock(
      async (repoPath: string, doneVisibleDays?: number): Promise<TaskCard[]> => {
        if (repoPath === "/repo") {
          return [
            {
              ...taskFixture,
              status: currentStatus,
              id: `repo-${doneVisibleDays}`,
            },
          ];
        }

        if (repoPath === "/other") {
          return [{ ...taskFixture, id: "other-1", status: "open" }];
        }

        throw new Error(`Unexpected repo path: ${repoPath}`);
      },
    );
    host.tasksList = tasksList;

    await queryClient.fetchQuery(repoTaskDataQueryOptions("/repo", 1));
    await queryClient.fetchQuery(repoTaskDataQueryOptions("/repo", 7));
    await queryClient.fetchQuery(repoTaskDataQueryOptions("/other", 1));

    currentStatus = "in_progress";
    tasksList.mockClear();

    await refreshCachedKanbanQueries(queryClient, "/repo");

    expect(tasksList).toHaveBeenCalledTimes(2);
    expect(tasksList).toHaveBeenCalledWith("/repo", 1);
    expect(tasksList).toHaveBeenCalledWith("/repo", 7);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo", 1))?.tasks[0]
        ?.status,
    ).toBe("in_progress");
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo", 7))?.tasks[0]
        ?.status,
    ).toBe("in_progress");
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/other", 1))?.tasks[0]
        ?.status,
    ).toBe("open");
  });

  test("concurrent canonical task reads share one host call", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);
    host.tasksList = tasksList;

    const [repoTaskData, sameRepoTaskData] = await Promise.all([
      queryClient.fetchQuery(repoTaskDataQueryOptions("/repo", DONE_VISIBLE_DAYS)),
      queryClient.fetchQuery(repoTaskDataQueryOptions("/repo", DONE_VISIBLE_DAYS)),
    ]);

    expect(repoTaskData.tasks).toEqual([taskFixture]);
    expect(sameRepoTaskData.tasks).toEqual([taskFixture]);
    expect(tasksList).toHaveBeenCalledTimes(1);
    expect(tasksList).toHaveBeenCalledWith("/repo", DONE_VISIBLE_DAYS);
  });

  test("repo task view refresh resolves settings before document side effects", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);
    const settingsLoad = mock(async (): Promise<SettingsSnapshot> => {
      throw new Error("settings unavailable");
    });
    host.tasksList = tasksList;
    host.workspaceGetSettingsSnapshot = settingsLoad;
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "cached spec",
      updatedAt: null,
    });

    await expect(
      refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
        taskDocumentStrategy: "remove",
        taskIds: ["task-1"],
      }),
    ).rejects.toThrow("settings unavailable");

    expect(settingsLoad).toHaveBeenCalledTimes(1);
    expect(tasksList).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
        documentQueryKeys.spec("/repo", "task-1"),
      ),
    ).toEqual({
      markdown: "cached spec",
      updatedAt: null,
    });

    host.workspaceGetSettingsSnapshot = mock(
      async (): Promise<SettingsSnapshot> => settingsSnapshotFixture,
    );

    await refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      taskDocumentStrategy: "remove",
      taskIds: ["task-1"],
    });

    expect(tasksList).toHaveBeenCalledWith("/repo", DONE_VISIBLE_DAYS);
    expect(queryClient.getQueryData(documentQueryKeys.spec("/repo", "task-1"))).toBeUndefined();
  });

  test("repo task view refresh rejects cached settings from an errored settings query", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);
    host.tasksList = tasksList;
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "cached spec",
      updatedAt: null,
    });
    host.workspaceGetSettingsSnapshot = mock(async (): Promise<SettingsSnapshot> => {
      throw new Error("settings unavailable");
    });

    await expect(
      queryClient.fetchQuery({
        ...settingsSnapshotQueryOptions(),
        staleTime: 0,
      }),
    ).rejects.toThrow("settings unavailable");

    await expect(
      refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
        taskDocumentStrategy: "remove",
        taskIds: ["task-1"],
      }),
    ).rejects.toThrow("settings unavailable");

    expect(tasksList).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
        documentQueryKeys.spec("/repo", "task-1"),
      ),
    ).toEqual({
      markdown: "cached spec",
      updatedAt: null,
    });
  });

  test("repo task view refresh revalidates invalidated cached settings before side effects", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);
    host.tasksList = tasksList;
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "cached spec",
      updatedAt: null,
    });
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeys.settingsSnapshot(),
      exact: true,
      refetchType: "none",
    });
    host.workspaceGetSettingsSnapshot = mock(async (): Promise<SettingsSnapshot> => {
      throw new Error("settings unavailable");
    });

    await expect(
      refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
        taskDocumentStrategy: "remove",
        taskIds: ["task-1"],
      }),
    ).rejects.toThrow("settings unavailable");

    expect(tasksList).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
        documentQueryKeys.spec("/repo", "task-1"),
      ),
    ).toEqual({
      markdown: "cached spec",
      updatedAt: null,
    });
  });

  test("forced repo task view refresh joins older in-flight task reads without cancelling them", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    const firstTaskRead = createDeferred<TaskCard[]>();
    const tasksList = mock(async (): Promise<TaskCard[]> => firstTaskRead.promise);
    host.tasksList = tasksList;

    const olderRead = queryClient.fetchQuery(repoTaskDataQueryOptions("/repo", DONE_VISIBLE_DAYS));
    const refresh = refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      forceFreshTaskList: true,
      taskDocumentStrategy: "none",
    });
    firstTaskRead.resolve([{ ...taskFixture, id: "stale" }]);
    await Promise.all([olderRead, refresh]);

    expect(tasksList).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(
        taskQueryKeys.repoData("/repo", DONE_VISIBLE_DAYS),
      )?.tasks[0]?.id,
    ).toBe("stale");
  });

  test("external task-sync refresh cancels an in-flight stale repo task read before reloading", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    const staleTaskRead = createDeferred<TaskCard[]>();
    let listCallCount = 0;
    const tasksList = mock(async (): Promise<TaskCard[]> => {
      listCallCount += 1;
      if (listCallCount === 1) {
        return staleTaskRead.promise;
      }

      return [{ ...taskFixture, id: "fresh" }];
    });
    host.tasksList = tasksList;

    const olderRead = queryClient
      .fetchQuery(repoTaskDataQueryOptions("/repo", DONE_VISIBLE_DAYS))
      .catch((error) => error);
    await waitForMockCall(() => tasksList.mock.calls.length === 1);

    const refresh = refreshRepoTaskViewsAfterMutation(queryClient, "/repo", {
      forceFreshTaskList: true,
      ancillaryFailureMode: "best-effort",
      ignorePrimaryCancellation: true,
      refreshInactiveViews: false,
      taskDocumentStrategy: "invalidate",
      taskIds: ["task-1"],
    });
    await waitForMockCall(() => tasksList.mock.calls.length === 2);
    staleTaskRead.resolve([{ ...taskFixture, id: "stale" }]);

    await expect(refresh).resolves.toBeUndefined();
    await olderRead;

    expect(tasksList).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(
        taskQueryKeys.repoData("/repo", DONE_VISIBLE_DAYS),
      )?.tasks[0]?.id,
    ).toBe("fresh");
  });

  test("mutation refresh ignores superseded inactive-Kanban cancellation and keeps the fresh cache", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", 7), {
      tasks: [{ ...taskFixture, id: "stale-7" }],
    });
    const staleInactiveRead = createDeferred<TaskCard[]>();
    let inactiveReadCount = 0;
    const tasksList = mock(
      async (_repoPath: string, doneVisibleDays?: number): Promise<TaskCard[]> => {
        if (doneVisibleDays === 7) {
          inactiveReadCount += 1;
          if (inactiveReadCount === 1) {
            return staleInactiveRead.promise;
          }
          return [{ ...taskFixture, id: "fresh-7" }];
        }
        return [{ ...taskFixture, id: "fresh-1" }];
      },
    );
    host.tasksList = tasksList;

    const firstRefresh = refreshRepoTaskViewsAfterMutation(queryClient, "/repo", {
      forceFreshTaskList: true,
      ignorePrimaryCancellation: true,
      taskDocumentStrategy: "none",
    });
    await waitForMockCall(() => tasksList.mock.calls.some((call) => (call as unknown[])[1] === 7));

    const secondRefresh = refreshRepoTaskViewsAfterMutation(queryClient, "/repo", {
      forceFreshTaskList: true,
      ignorePrimaryCancellation: true,
      taskDocumentStrategy: "none",
    });
    await expect(firstRefresh).resolves.toBeUndefined();
    await expect(secondRefresh).resolves.toBeUndefined();

    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo", 7))?.tasks[0]
        ?.id,
    ).toBe("fresh-7");
    staleInactiveRead.resolve([{ ...taskFixture, id: "stale-7" }]);
  });

  test("mutation refresh rejects a real inactive-Kanban ancillary failure", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", 7), {
      tasks: [{ ...taskFixture, id: "stale-7" }],
    });
    host.tasksList = mock(
      async (_repoPath: string, doneVisibleDays?: number): Promise<TaskCard[]> => {
        if (doneVisibleDays === 7) {
          throw new Error("inactive Kanban unavailable");
        }
        return [{ ...taskFixture, id: "fresh-1" }];
      },
    );

    await expect(
      refreshRepoTaskViewsAfterMutation(queryClient, "/repo", {
        forceFreshTaskList: true,
        ignorePrimaryCancellation: true,
        taskDocumentStrategy: "none",
      }),
    ).rejects.toThrow("inactive Kanban unavailable");
  });

  test("non-forced repo task view refresh joins an older in-flight task read", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    const taskRead = createDeferred<TaskCard[]>();
    const tasksList = mock(async (): Promise<TaskCard[]> => taskRead.promise);
    host.tasksList = tasksList;

    const olderRead = queryClient.fetchQuery(repoTaskDataQueryOptions("/repo", DONE_VISIBLE_DAYS));
    const refresh = refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      taskDocumentStrategy: "none",
    });
    taskRead.resolve([{ ...taskFixture, id: "joined" }]);
    await Promise.all([olderRead, refresh]);

    expect(tasksList).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(
        taskQueryKeys.repoData("/repo", DONE_VISIBLE_DAYS),
      )?.tasks[0]?.id,
    ).toBe("joined");
  });

  test("non-forced repo task view refresh reuses cached task data", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", DONE_VISIBLE_DAYS), {
      tasks: [{ ...taskFixture, id: "cached" }],
    });
    const tasksList = mock(async (): Promise<TaskCard[]> => [{ ...taskFixture, id: "fresh" }]);
    host.tasksList = tasksList;

    await refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      taskDocumentStrategy: "none",
    });

    expect(tasksList).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(
        taskQueryKeys.repoData("/repo", DONE_VISIBLE_DAYS),
      )?.tasks[0]?.id,
    ).toBe("cached");
  });

  test("forced repo task view refresh updates cached done-visible variants", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", 7), {
      tasks: [{ ...taskFixture, id: "stale-7" }],
    });
    const tasksList = mock(
      async (_repoPath: string, doneVisibleDays?: number): Promise<TaskCard[]> => [
        { ...taskFixture, id: `fresh-${doneVisibleDays}` },
      ],
    );
    host.tasksList = tasksList;

    await refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      forceFreshTaskList: true,
      taskDocumentStrategy: "none",
    });

    expect(tasksList).toHaveBeenCalledWith("/repo", DONE_VISIBLE_DAYS);
    expect(tasksList).toHaveBeenCalledWith("/repo", 7);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo", 7))?.tasks[0]
        ?.id,
    ).toBe("fresh-7");
  });

  test("external repo task view refresh invalidates cached documents without fetching them", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "cached spec",
      updatedAt: null,
    });
    const tasksList = mock(async (): Promise<TaskCard[]> => [{ ...taskFixture, id: "fresh" }]);
    const taskDocumentGetFresh = mock(async () => {
      throw new Error("document fetch should not run");
    });
    host.tasksList = tasksList;
    host.taskDocumentGetFresh = taskDocumentGetFresh;

    await refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      forceFreshTaskList: true,
      ancillaryFailureMode: "best-effort",
      refreshInactiveViews: false,
      taskDocumentStrategy: "invalidate",
      taskIds: ["task-1"],
    });

    expect(tasksList).toHaveBeenCalledTimes(1);
    expect(tasksList).toHaveBeenCalledWith("/repo", DONE_VISIBLE_DAYS);
    expect(taskDocumentGetFresh).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(documentQueryKeys.spec("/repo", "task-1"))?.isInvalidated,
    ).toBe(true);
  });

  test("external repo task view refresh rejects when the primary task list fails", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    host.tasksList = mock(async (): Promise<TaskCard[]> => {
      throw new Error("current board failed");
    });

    await expect(
      refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
        forceFreshTaskList: true,
        ancillaryFailureMode: "best-effort",
        refreshInactiveViews: false,
        taskDocumentStrategy: "none",
      }),
    ).rejects.toThrow("current board failed");
  });

  test("external repo task view refresh joins overlapping primary task reads", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    const firstRead = createDeferred<TaskCard[]>();
    const tasksList = mock(async (): Promise<TaskCard[]> => firstRead.promise);
    host.tasksList = tasksList;

    const firstRefresh = refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      forceFreshTaskList: true,
      ancillaryFailureMode: "best-effort",
      ignorePrimaryCancellation: true,
      refreshInactiveViews: false,
      taskDocumentStrategy: "none",
    });
    await waitForMockCall(() => tasksList.mock.calls.length > 0);
    expect(tasksList).toHaveBeenCalledTimes(1);

    const secondRefresh = refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      forceFreshTaskList: true,
      ancillaryFailureMode: "best-effort",
      ignorePrimaryCancellation: true,
      refreshInactiveViews: false,
      taskDocumentStrategy: "none",
    });

    firstRead.resolve([{ ...taskFixture, id: "stale" }]);
    await expect(firstRefresh).resolves.toBeUndefined();
    await expect(secondRefresh).resolves.toBeUndefined();

    expect(tasksList).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(
        taskQueryKeys.repoData("/repo", DONE_VISIBLE_DAYS),
      )?.tasks[0]?.id,
    ).toBe("stale");
  });

  test("overlapping external targeted refreshes still invalidate affected task documents", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "task 1 spec",
      updatedAt: null,
    });
    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-2"), {
      markdown: "task 2 spec",
      updatedAt: null,
    });
    const firstRead = createDeferred<TaskCard[]>();
    const tasksList = mock(async (): Promise<TaskCard[]> => firstRead.promise);
    host.tasksList = tasksList;

    const firstRefresh = refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      forceFreshTaskList: true,
      ancillaryFailureMode: "best-effort",
      ignorePrimaryCancellation: true,
      refreshInactiveViews: false,
      taskDocumentStrategy: "invalidate",
      taskIds: ["task-1"],
    });
    await waitForMockCall(() => tasksList.mock.calls.length > 0);
    expect(tasksList).toHaveBeenCalledTimes(1);

    const secondRefresh = refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      forceFreshTaskList: true,
      ancillaryFailureMode: "best-effort",
      ignorePrimaryCancellation: true,
      refreshInactiveViews: false,
      taskDocumentStrategy: "invalidate",
      taskIds: ["task-2"],
    });

    firstRead.resolve([{ ...taskFixture, id: "stale" }]);
    await expect(firstRefresh).resolves.toBeUndefined();
    await expect(secondRefresh).resolves.toBeUndefined();

    expect(
      queryClient.getQueryState(documentQueryKeys.spec("/repo", "task-1"))?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(documentQueryKeys.spec("/repo", "task-2"))?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(
        taskQueryKeys.repoData("/repo", DONE_VISIBLE_DAYS),
      )?.tasks[0]?.id,
    ).toBe("stale");
  });

  test("external repo task view refresh skips inactive done-visible variants", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), settingsSnapshotFixture);
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", 7), {
      tasks: [{ ...taskFixture, id: "cached-7" }],
    });
    const tasksList = mock(
      async (_repoPath: string, doneVisibleDays?: number): Promise<TaskCard[]> => {
        if (doneVisibleDays === 7) {
          throw new Error("inactive variant should not refresh");
        }
        return [{ ...taskFixture, id: `fresh-${doneVisibleDays}` }];
      },
    );
    host.tasksList = tasksList;

    await refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      forceFreshTaskList: true,
      ancillaryFailureMode: "best-effort",
      refreshInactiveViews: false,
      taskDocumentStrategy: "none",
    });

    expect(tasksList).toHaveBeenCalledTimes(1);
    expect(tasksList).toHaveBeenCalledWith("/repo", DONE_VISIBLE_DAYS);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo", 7))?.tasks[0]
        ?.id,
    ).toBe("cached-7");
  });
});
