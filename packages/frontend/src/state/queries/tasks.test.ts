import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createRepoTaskDataQueryOptions, invalidateRepoTaskQueries, taskQueryKeys } from "./tasks";

const task: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
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
  createdAt: "2026-03-22T12:00:00.000Z",
  updatedAt: "2026-03-22T12:00:00.000Z",
};

describe("tasks query options", () => {
  test("loads task data with one repository-scoped query key", async () => {
    const queryClient = new QueryClient();
    const listTasks = mock(async (): Promise<TaskCard[]> => [task]);

    await queryClient.fetchQuery(createRepoTaskDataQueryOptions(listTasks)("/repo"));

    expect(listTasks).toHaveBeenCalledWith("/repo");
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo")),
    ).toEqual({
      tasks: [task],
    });
  });

  test("uses the same cache entry across 1 to 7 to 1 day retention changes and refreshes", async () => {
    const queryClient = new QueryClient();
    let doneVisibleDays = 1;
    const listTasks = mock(async (): Promise<TaskCard[]> => [
      { ...task, title: `Visible for ${doneVisibleDays} days` },
    ]);
    const query = createRepoTaskDataQueryOptions(listTasks)("/repo");

    await queryClient.fetchQuery({ ...query, staleTime: 0 });
    doneVisibleDays = 7;
    await queryClient.fetchQuery({ ...query, staleTime: 0 });
    doneVisibleDays = 1;
    await queryClient.fetchQuery({ ...query, staleTime: 0 });

    expect(listTasks).toHaveBeenCalledTimes(3);
    expect(
      queryClient.getQueryCache().findAll({ queryKey: taskQueryKeys.repoData("/repo") }),
    ).toHaveLength(1);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo"))?.tasks[0]
        ?.title,
    ).toBe("Visible for 1 days");
  });

  test("invalidates the repository task query", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), { tasks: [task] });
    queryClient.setQueryData(taskQueryKeys.repoData("/other"), { tasks: [task] });

    await invalidateRepoTaskQueries(queryClient, "/repo");

    expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(taskQueryKeys.repoData("/other"))?.isInvalidated).toBe(false);
  });
});
