import { workspaceRefFixture } from "../test-support/workspace-ref-fixture";
import { describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createRepoTaskDataQueryOptions, invalidateRepoTaskQueries, taskQueryKeys } from "./tasks";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

const task: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  removeWorktreeOnClose: null,
  availableActions: [],
  labels: [],
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    build: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  createdAt: "2026-03-22T12:00:00.000Z",
  updatedAt: "2026-03-22T12:00:00.000Z",
};

describe("tasks query options", () => {
  test("loads task data with one repository-scoped query key", async () => {
    const queryClient = new QueryClient();
    const listTasks = mock(async (): Promise<TaskCard[]> => [task]);

    await queryClient.fetchQuery(
      createRepoTaskDataQueryOptions(listTasks)(workspaceRefFixture("/repo")),
    );

    expect(listTasks).toHaveBeenCalledWith(workspaceRefFixture("/repo"), queryClient);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(
        taskQueryKeys.repoData(workspaceRefFixture("/repo")),
      ),
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
    const query = createRepoTaskDataQueryOptions(listTasks)(workspaceRefFixture("/repo"));

    await queryClient.fetchQuery({ ...query, staleTime: 0 });
    doneVisibleDays = 7;
    await queryClient.fetchQuery({ ...query, staleTime: 0 });
    doneVisibleDays = 1;
    await queryClient.fetchQuery({ ...query, staleTime: 0 });

    expect(listTasks).toHaveBeenCalledTimes(3);
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: taskQueryKeys.repoData(workspaceRefFixture("/repo")) }),
    ).toHaveLength(1);
    expect(
      queryClient.getQueryData<{ tasks: TaskCard[] }>(
        taskQueryKeys.repoData(workspaceRefFixture("/repo")),
      )?.tasks[0]?.title,
    ).toBe("Visible for 1 days");
  });

  test("isolates replacement workspaces at the same repository path", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(taskQueryKeys.repoData(workspaceRefFixture("/repo")), {
      tasks: [task],
    });
    const replacement = workspaceRefFixture("/repo", "replacement");
    queryClient.setQueryData(taskQueryKeys.repoData(replacement), { tasks: [task] });

    await invalidateRepoTaskQueries(queryClient, workspaceRefFixture("/repo"));

    expect(
      queryClient.getQueryState(taskQueryKeys.repoData(workspaceRefFixture("/repo")))
        ?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(taskQueryKeys.repoData(replacement))?.isInvalidated).toBe(
      false,
    );
  });
});
