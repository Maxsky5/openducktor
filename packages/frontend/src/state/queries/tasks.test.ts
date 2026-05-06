import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";
import { refreshRepoTaskViewsFromQuery } from "./task-view-sync";
import {
  invalidateRepoTaskQueries,
  kanbanTaskListQueryOptions,
  loadRepoTaskDataFromQuery,
  refetchActiveKanbanQueries,
  refreshCachedKanbanQueries,
  repoTaskDataQueryOptions,
  repoVisibleTasksQueryOptions,
  taskQueryKeys,
  upsertAgentSessionInRepoTaskData,
} from "./tasks";

const DONE_VISIBLE_DAYS = 1;

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  notes: "",
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

const sessionFixture: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  startedAt: "2026-03-22T12:00:00.000Z",
  selectedModel: null,
};

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
};

describe("tasks query cache helpers", () => {
  const originalTasksList = host.tasksList;

  afterEach(() => {
    host.tasksList = originalTasksList;
  });

  test("upsertAgentSessionInRepoTaskData inserts a persisted session into the repo task cache", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), {
      tasks: [taskFixture],
    });
    queryClient.setQueryData(taskQueryKeys.visibleTasks("/repo"), [taskFixture]);
    queryClient.setQueryData(taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS), [
      taskFixture,
    ] satisfies TaskCard[]);

    upsertAgentSessionInRepoTaskData(queryClient, "/repo", "task-1", sessionFixture);

    const repoTaskData = queryClient.getQueryData<{
      tasks: TaskCard[];
    }>(taskQueryKeys.repoData("/repo"));
    const kanbanTasks = queryClient.getQueryData<TaskCard[]>(
      taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS),
    );
    const visibleTasks = queryClient.getQueryData<TaskCard[]>(taskQueryKeys.visibleTasks("/repo"));

    expect(repoTaskData?.tasks[0]?.agentSessions).toEqual([sessionFixture]);
    expect(visibleTasks?.[0]?.agentSessions).toEqual([sessionFixture]);
    expect(kanbanTasks?.[0]?.agentSessions).toEqual([sessionFixture]);
  });

  test("upsertAgentSessionInRepoTaskData replaces the existing persisted session for the same id", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), {
      tasks: [
        {
          ...taskFixture,
          agentSessions: [sessionFixture],
        },
      ],
    });
    queryClient.setQueryData(taskQueryKeys.visibleTasks("/repo"), [
      {
        ...taskFixture,
        agentSessions: [sessionFixture],
      },
    ] satisfies TaskCard[]);
    queryClient.setQueryData(taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS), [
      {
        ...taskFixture,
        agentSessions: [sessionFixture],
      },
    ] satisfies TaskCard[]);

    const updatedSession: AgentSessionRecord = {
      ...sessionFixture,
      workingDirectory: "/tmp/repo/worktree-2",
    };

    upsertAgentSessionInRepoTaskData(queryClient, "/repo", "task-1", updatedSession);

    const repoTaskData = queryClient.getQueryData<{
      tasks: TaskCard[];
    }>(taskQueryKeys.repoData("/repo"));
    const kanbanTasks = queryClient.getQueryData<TaskCard[]>(
      taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS),
    );
    const visibleTasks = queryClient.getQueryData<TaskCard[]>(taskQueryKeys.visibleTasks("/repo"));

    expect(repoTaskData?.tasks[0]?.agentSessions).toEqual([updatedSession]);
    expect(visibleTasks?.[0]?.agentSessions).toEqual([updatedSession]);
    expect(kanbanTasks?.[0]?.agentSessions).toEqual([updatedSession]);
  });

  test("repoVisibleTasksQueryOptions loads visible tasks", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);

    host.tasksList = tasksList;

    const tasks = await queryClient.fetchQuery(repoVisibleTasksQueryOptions("/repo"));

    expect(tasks).toEqual([taskFixture]);
    expect(tasksList).toHaveBeenCalledWith("/repo");
  });

  test("repo visible task reads share the canonical repo task-data query", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);

    host.tasksList = tasksList;

    const [repoTaskData, visibleTasks] = await Promise.all([
      queryClient.fetchQuery(repoTaskDataQueryOptions("/repo")),
      queryClient.fetchQuery(repoVisibleTasksQueryOptions("/repo")),
    ]);

    expect(repoTaskData.tasks).toEqual([taskFixture]);
    expect(visibleTasks).toEqual([taskFixture]);
    expect(tasksList).toHaveBeenCalledTimes(1);
    expect(tasksList).toHaveBeenCalledWith("/repo");
  });

  test("loadRepoTaskDataFromQuery prepopulates visible tasks cache", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);

    host.tasksList = tasksList;

    const repoTaskData = await loadRepoTaskDataFromQuery(queryClient, "/repo");

    expect(repoTaskData.tasks).toEqual([taskFixture]);
    expect(queryClient.getQueryData<TaskCard[]>(taskQueryKeys.visibleTasks("/repo"))).toEqual([
      taskFixture,
    ]);
  });

  test("loadRepoTaskDataFromQuery syncs visible tasks when it joins an in-flight repo-data read", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(async (): Promise<TaskCard[]> => [taskFixture]);

    host.tasksList = tasksList;

    await Promise.all([
      queryClient.fetchQuery(repoTaskDataQueryOptions("/repo")),
      loadRepoTaskDataFromQuery(queryClient, "/repo"),
    ]);

    expect(tasksList).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<TaskCard[]>(taskQueryKeys.visibleTasks("/repo"))).toEqual([
      taskFixture,
    ]);
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

    const repoAObserver = new QueryObserver(queryClient, kanbanTaskListQueryOptions("/repo-a", 1));
    const repoBObserver = new QueryObserver(queryClient, kanbanTaskListQueryOptions("/repo-b", 1));
    const unsubscribeRepoA = repoAObserver.subscribe(() => {});
    const unsubscribeRepoB = repoBObserver.subscribe(() => {});

    try {
      await repoAObserver.refetch();
      await repoBObserver.refetch();
      const initialRepoBTaskId = queryClient.getQueryData<TaskCard[]>(
        taskQueryKeys.kanbanData("/repo-b", 1),
      )?.[0]?.id;
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
        queryClient.getQueryData<TaskCard[]>(taskQueryKeys.kanbanData("/repo-a", 1))?.[0]?.id,
      ).toBe("repo-a-2");
      expect(
        queryClient.getQueryData<TaskCard[]>(taskQueryKeys.kanbanData("/repo-b", 1))?.[0]?.id,
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

    queryClient.setQueryData(taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS), [taskFixture]);

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

    await queryClient.fetchQuery(kanbanTaskListQueryOptions("/repo", 1));
    await queryClient.fetchQuery(kanbanTaskListQueryOptions("/repo", 7));
    await queryClient.fetchQuery(kanbanTaskListQueryOptions("/other", 1));

    currentStatus = "in_progress";
    tasksList.mockClear();

    await refreshCachedKanbanQueries(queryClient, "/repo");

    expect(tasksList).toHaveBeenCalledTimes(2);
    expect(tasksList).toHaveBeenCalledWith("/repo", 1);
    expect(tasksList).toHaveBeenCalledWith("/repo", 7);
    expect(
      queryClient.getQueryData<TaskCard[]>(taskQueryKeys.kanbanData("/repo", 1))?.[0]?.status,
    ).toBe("in_progress");
    expect(
      queryClient.getQueryData<TaskCard[]>(taskQueryKeys.kanbanData("/repo", 7))?.[0]?.status,
    ).toBe("in_progress");
    expect(
      queryClient.getQueryData<TaskCard[]>(taskQueryKeys.kanbanData("/other", 1))?.[0]?.status,
    ).toBe("open");
  });

  test("concurrent repo task view refreshes queue one trailing task-list refresh", async () => {
    const queryClient = new QueryClient();
    let repoRefreshCount = 0;
    let kanbanRefreshCount = 0;
    const tasksList = mock(
      async (repoPath: string, doneVisibleDays?: number): Promise<TaskCard[]> => {
        if (repoPath !== "/repo") {
          throw new Error(`Unexpected repo path: ${repoPath}`);
        }

        if (doneVisibleDays === undefined) {
          repoRefreshCount += 1;
        } else {
          kanbanRefreshCount += 1;
        }

        return [
          {
            ...taskFixture,
            id:
              doneVisibleDays === undefined
                ? `repo-data-${repoRefreshCount}`
                : `kanban-${kanbanRefreshCount}`,
          },
        ];
      },
    );
    host.tasksList = tasksList;
    queryClient.setQueryData(taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS), [taskFixture]);

    await Promise.all([
      refreshRepoTaskViewsFromQuery(queryClient, "/repo"),
      refreshRepoTaskViewsFromQuery(queryClient, "/repo"),
    ]);

    expect(tasksList).toHaveBeenCalledTimes(4);
    expect(tasksList).toHaveBeenCalledWith("/repo");
    expect(tasksList).toHaveBeenCalledWith("/repo", DONE_VISIBLE_DAYS);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo"))?.tasks[0]
        ?.id,
    ).toBe("repo-data-2");
    expect(
      queryClient.getQueryData<TaskCard[]>(
        taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS),
      )?.[0]?.id,
    ).toBe("kanban-2");
  });

  test("startup task queries and lifecycle refresh share in-flight task-list reads", async () => {
    const queryClient = new QueryClient();
    const tasksList = mock(
      async (repoPath: string, doneVisibleDays?: number): Promise<TaskCard[]> => {
        if (repoPath !== "/repo") {
          throw new Error(`Unexpected repo path: ${repoPath}`);
        }

        return [
          {
            ...taskFixture,
            id: doneVisibleDays === undefined ? "repo-data" : `kanban-${doneVisibleDays}`,
          },
        ];
      },
    );
    host.tasksList = tasksList;

    await Promise.all([
      queryClient.fetchQuery(repoTaskDataQueryOptions("/repo")),
      queryClient.fetchQuery(kanbanTaskListQueryOptions("/repo", DONE_VISIBLE_DAYS)),
      refreshRepoTaskViewsFromQuery(queryClient, "/repo"),
    ]);

    expect(tasksList).toHaveBeenCalledTimes(2);
    expect(tasksList).toHaveBeenCalledWith("/repo");
    expect(tasksList).toHaveBeenCalledWith("/repo", DONE_VISIBLE_DAYS);
  });

  test("force-fresh task refresh does not join a stale pre-existing repo-data fetch", async () => {
    const queryClient = new QueryClient();
    const staleList = createDeferred<TaskCard[]>();
    let callCount = 0;
    const tasksList = mock(async (): Promise<TaskCard[]> => {
      callCount += 1;
      if (callCount === 1) {
        return staleList.promise;
      }

      return [{ ...taskFixture, id: "fresh" }];
    });
    host.tasksList = tasksList;

    const staleFetch = queryClient.fetchQuery(repoTaskDataQueryOptions("/repo")).catch(() => {
      // The force-fresh refresh cancels the pre-existing read so it cannot publish stale data.
    });
    await Promise.resolve();

    const refresh = refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      forceFreshTaskList: true,
    });
    staleList.resolve([{ ...taskFixture, id: "stale" }]);
    await Promise.all([staleFetch, refresh]);

    expect(tasksList).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo"))?.tasks[0]
        ?.id,
    ).toBe("fresh");
  });

  test("force-fresh task refresh cancels a stale coalesced refresh before publishing", async () => {
    const queryClient = new QueryClient();
    const staleList = createDeferred<TaskCard[]>();
    let callCount = 0;
    const tasksList = mock(async (): Promise<TaskCard[]> => {
      callCount += 1;
      if (callCount === 1) {
        return staleList.promise;
      }

      return [{ ...taskFixture, id: "fresh" }];
    });
    host.tasksList = tasksList;

    const staleRefresh = refreshRepoTaskViewsFromQuery(queryClient, "/repo");
    await Promise.resolve();

    const forceFreshRefresh = refreshRepoTaskViewsFromQuery(queryClient, "/repo", {
      forceFreshTaskList: true,
    });
    staleList.resolve([{ ...taskFixture, id: "stale" }]);
    await Promise.all([staleRefresh, forceFreshRefresh]);

    expect(tasksList).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo"))?.tasks[0]
        ?.id,
    ).toBe("fresh");
  });
});
