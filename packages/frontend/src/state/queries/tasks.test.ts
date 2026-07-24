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
  test("loads task data with the repository and done-visible-days query key", async () => {
    const queryClient = new QueryClient();
    const listTasks = mock(async (): Promise<TaskCard[]> => [task]);

    await queryClient.fetchQuery(createRepoTaskDataQueryOptions(listTasks)("/repo", 7));

    expect(listTasks).toHaveBeenCalledWith("/repo", 7);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo", 7)),
    ).toEqual({
      tasks: [task],
    });
  });

  test("invalidates every cached task-query variant for a repository", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", 1), { tasks: [task] });
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", 7), { tasks: [task] });
    queryClient.setQueryData(taskQueryKeys.repoData("/other", 1), { tasks: [task] });

    await invalidateRepoTaskQueries(queryClient, "/repo");

    expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo", 1))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo", 7))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(taskQueryKeys.repoData("/other", 1))?.isInvalidated).toBe(
      false,
    );
  });
});
