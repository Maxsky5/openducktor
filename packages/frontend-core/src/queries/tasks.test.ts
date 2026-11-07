import { isCancelledError } from "@tanstack/react-query";
import { builtinWorkspaceWorkflowFixture } from "../test-support/workflow-fixtures";
import { describe, expect, mock, test } from "bun:test";
import { createWireTaskCardFixture } from "../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { workspaceRefFixture } from "../test-support/workspace-ref-fixture";
import {
  invalidateRepoTaskQueries,
  repoTaskDataQueryOptions,
  unfilteredRepoTaskDataQueryOptions,
  taskQueryKeys,
  type RepoTaskData,
} from "./tasks";

const scope = workspaceRefFixture("/repo");

describe("tasks query options", () => {
  test.each([
    { options: repoTaskDataQueryOptions, command: "tasksList" as const },
    { options: unfilteredRepoTaskDataQueryOptions, command: "tasksListAll" as const },
  ])(
    "loads task data through the production query and resolves its exact workflow",
    async ({ options, command }) => {
      const task = createWireTaskCardFixture({ id: "task-1", title: "Task" });
      const rows = Promise.withResolvers<(typeof task)[]>();
      const read = mock(() => rows.promise);
      const board = mock(async () => builtinWorkspaceWorkflowFixture);
      const connection = createTestClientConnection({
        client: { [command]: read, workspaceWorkflowGet: board },
      });
      try {
        const pending = connection.queryClient.fetchQuery(options(scope));
        expect(board).toHaveBeenCalledTimes(1);
        rows.resolve([task]);
        const result = await pending;
        expect(read).toHaveBeenCalledWith(scope);
        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0]).toMatchObject({ id: task.id, workflow: task.workflow });
        expect(result.tasks[0]?.taskWorkflow.reference).toEqual(task.workflow);
        expect(result.tasks[0]?.sharedState.id).toBe(task.status);
      } finally {
        rows.resolve([]);
        await connection.dispose();
      }
    },
  );

  test("uses the same cache entry across 1 to 7 to 1 day retention changes and refreshes", async () => {
    let doneVisibleDays = 1;
    const read = mock(async () => [
      createWireTaskCardFixture({ title: `Visible for ${doneVisibleDays} days` }),
    ]);
    const connection = createTestClientConnection({ client: { tasksList: read } });
    const queryClient = connection.queryClient;
    const query = repoTaskDataQueryOptions(scope);
    try {
      for (const days of [1, 7, 1]) {
        doneVisibleDays = days;
        await queryClient.fetchQuery({ ...query, staleTime: 0 });
      }
      expect(read).toHaveBeenCalledTimes(3);
      expect(
        queryClient.getQueryCache().findAll({ queryKey: taskQueryKeys.repoData(scope) }),
      ).toHaveLength(1);
      expect(queryClient.getQueryData<RepoTaskData>(query.queryKey)?.tasks[0]?.title).toBe(
        "Visible for 1 days",
      );
    } finally {
      await connection.dispose();
    }
  });

  test("isolates replacement workspaces at the same repository path", async () => {
    const connection = createTestClientConnection();
    const queryClient = connection.queryClient;
    const replacement = workspaceRefFixture("/repo", "replacement");
    try {
      queryClient.setQueryData(taskQueryKeys.repoData(scope), { tasks: [] });
      queryClient.setQueryData(taskQueryKeys.repoData(replacement), { tasks: [] });
      await invalidateRepoTaskQueries(queryClient, scope);
      expect(queryClient.getQueryState(taskQueryKeys.repoData(scope))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(taskQueryKeys.repoData(replacement))?.isInvalidated).toBe(
        false,
      );
    } finally {
      await connection.dispose();
    }
  });

  test("rejects a task whose workflow revision is outside the host inventory", async () => {
    const task = createWireTaskCardFixture();
    task.workflow = { ...task.workflow, revision: task.workflow.revision + 1 };
    const connection = createTestClientConnection({ client: { tasksList: async () => [task] } });
    try {
      await expect(
        connection.queryClient.fetchQuery(repoTaskDataQueryOptions(scope)),
      ).rejects.toThrow("outside this workspace");
      expect(connection.queryClient.getQueryData(taskQueryKeys.repoData(scope))).toBeUndefined();
    } finally {
      await connection.dispose();
    }
  });

  test("does not cache a task read that completes after cancellation", async () => {
    const rows = Promise.withResolvers<ReturnType<typeof createWireTaskCardFixture>[]>();
    const connection = createTestClientConnection({ client: { tasksList: () => rows.promise } });
    const queryClient = connection.queryClient;
    try {
      const pending = queryClient
        .fetchQuery(repoTaskDataQueryOptions(scope))
        .catch((cause: unknown) => cause);
      await queryClient.cancelQueries({ queryKey: taskQueryKeys.repoData(scope) });
      rows.resolve([createWireTaskCardFixture()]);
      expect(isCancelledError(await pending)).toBe(true);
      expect(queryClient.getQueryData(taskQueryKeys.repoData(scope))).toBeUndefined();
    } finally {
      rows.resolve([]);
      await connection.dispose();
    }
  });
});
