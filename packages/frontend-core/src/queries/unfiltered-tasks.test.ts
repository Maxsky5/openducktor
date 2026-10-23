import { expect, mock, test } from "bun:test";
import { QueryObserver } from "@tanstack/react-query";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { createTaskCardFixture } from "../test-support/shared-test-fixtures";
import { createTaskViewSync } from "./task-view-sync";
import { boardEvent, eventCursor } from "./task-view-sync.test-support";
import {
  type RepoTaskData,
  repoTaskDataQueryOptions,
  taskQueryKeys,
  unfilteredRepoTaskDataQueryOptions,
} from "./tasks";

test("complete task views keep omitted closed tasks current through events and recovery", async () => {
  const closed = createTaskCardFixture({ id: "closed-task", status: "closed" });
  let tasks = [closed];
  const listAll = mock(async () => tasks);
  const connection = createTestClientConnection({
    client: { tasksList: async () => [], tasksListAll: listAll },
  });
  const client = connection.queryClient;
  const options = unfilteredRepoTaskDataQueryOptions("/repo");
  const sync = createTaskViewSync({
    queryClient: client,
    ports: {
      listTasks: async () => [],
      loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
    },
  });
  const stop = new QueryObserver(client, options).subscribe(() => {});
  try {
    await client.fetchQuery(options);
    await client.fetchQuery(repoTaskDataQueryOptions("/repo"));
    expect(client.getQueryData(taskQueryKeys.repoData("/repo"))).toEqual({ tasks: [] });
    expect(client.getQueryData(options.queryKey)).toEqual({ tasks: [closed] });

    const unrelated = createTaskCardFixture({ id: "other-task" });
    await sync.reconcileExternalEvent(boardEvent("/repo", [unrelated]), eventCursor(1));
    expect(client.getQueryData(options.queryKey)?.tasks).toContainEqual(closed);
    expect(listAll).toHaveBeenCalledTimes(1);

    tasks = [{ ...closed, title: "Edited outside the board" }];
    await sync.reconcileExternalEvent(boardEvent("/repo", tasks), eventCursor(2));
    expect(client.getQueryData(options.queryKey)?.tasks).toContainEqual(tasks[0]);
    expect(
      client.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo"))?.tasks,
    ).not.toContainEqual(tasks[0]);
    expect(listAll).toHaveBeenCalledTimes(1);

    tasks = [{ ...closed, title: "Edited during a stream gap" }];
    await sync.reconcileStreamSnapshot(["/repo"]);
    expect(client.getQueryData(options.queryKey)).toEqual({ tasks });

    tasks = [];
    await sync.refreshManually("/repo");
    expect(client.getQueryData(options.queryKey)).toEqual({ tasks: [] });
    expect(listAll).toHaveBeenCalledTimes(3);
    await sync.releaseWorkspace("/repo");
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
  } finally {
    stop();
    client.clear();
  }
});

test("task events patch hidden complete lists without reading them", async () => {
  const closed = createTaskCardFixture({ id: "closed-task", status: "closed" });
  const listAll = mock(async () => [closed]);
  const connection = createTestClientConnection({ client: { tasksListAll: listAll } });
  const client = connection.queryClient;
  const options = unfilteredRepoTaskDataQueryOptions("/repo");
  const sync = createTaskViewSync({
    queryClient: client,
    ports: {
      listTasks: async () => [],
      loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
    },
  });
  try {
    await client.fetchQuery(options);
    const updated = { ...closed, title: "Updated while hidden" };
    await sync.reconcileExternalEvent(boardEvent("/repo", [updated]), eventCursor(1));
    expect(client.getQueryData(options.queryKey)).toEqual({ tasks: [updated] });
    expect(listAll).toHaveBeenCalledTimes(1);
  } finally {
    client.clear();
  }
});

test.each([false, true])(
  "an inactive complete list stays stale after a gap when the board read fails=%s",
  async (failBoard) => {
    const closed = createTaskCardFixture({ id: "closed-task", status: "closed" });
    let tasks = [closed];
    const listAll = mock(async () => tasks);
    const connection = createTestClientConnection({ client: { tasksListAll: listAll } });
    const client = connection.queryClient;
    const options = unfilteredRepoTaskDataQueryOptions("/repo");
    const sync = createTaskViewSync({
      queryClient: client,
      ports: {
        listTasks: async () => {
          if (failBoard) throw new Error("Board read failed");
          return [];
        },
        loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
      },
    });
    try {
      await client.fetchQuery(options);
      tasks = [{ ...closed, title: "Missed during the gap" }];
      await sync.reconcileStreamSnapshot(["/repo"]);
      await sync.reconcileExternalEvent(
        boardEvent("/repo", [createTaskCardFixture({ id: "other-task" })]),
        eventCursor(1),
      );
      expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
      expect(listAll).toHaveBeenCalledTimes(1);
      expect(await client.fetchQuery(options)).toEqual({ tasks });
      expect(listAll).toHaveBeenCalledTimes(2);
    } finally {
      client.clear();
    }
  },
);

test("a failed complete-list recovery waits for a full read before applying later events", async () => {
  const closed = createTaskCardFixture({ id: "closed-task", status: "closed" });
  const failure = new Error("Task store is unavailable");
  let fail = false;
  const connection = createTestClientConnection({
    client: {
      tasksListAll: async () => {
        if (fail) throw failure;
        return [closed];
      },
    },
  });
  const client = connection.queryClient;
  const options = unfilteredRepoTaskDataQueryOptions("/repo");
  const sync = createTaskViewSync({
    queryClient: client,
    ports: {
      listTasks: async () => [],
      loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
    },
  });
  const stop = new QueryObserver(client, options).subscribe(() => {});
  try {
    await client.fetchQuery(options);
    fail = true;
    const snapshot = await sync.reconcileStreamSnapshot(["/repo"]);
    expect(snapshot.failures.get("/repo")).toBe(failure);
    await sync.reconcileExternalEvent(
      boardEvent("/repo", [{ ...closed, title: "Later event" }]),
      eventCursor(1),
    );
    expect(client.getQueryState(options.queryKey)?.error).toBe(failure);
    expect(client.getQueryData(options.queryKey)).toEqual({ tasks: [closed] });
    fail = false;
    await sync.refreshManually("/repo");
    expect(client.getQueryState(options.queryKey)?.status).toBe("success");
  } finally {
    stop();
    client.clear();
  }
});

test("a late complete-list read cannot replace a committed task event", async () => {
  const closed = createTaskCardFixture({ id: "closed-task", status: "closed" });
  const pending = Promise.withResolvers<(typeof closed)[]>();
  const listAll = mock(async () => (listAll.mock.calls.length === 1 ? [closed] : pending.promise));
  const connection = createTestClientConnection({ client: { tasksListAll: listAll } });
  const client = connection.queryClient;
  const options = unfilteredRepoTaskDataQueryOptions("/repo");
  const sync = createTaskViewSync({
    queryClient: client,
    ports: {
      listTasks: async () => [],
      loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
    },
  });
  try {
    await client.fetchQuery(options);
    const read = client.fetchQuery({ ...options, staleTime: 0 }).catch(() => {});
    const updated = { ...closed, title: "Committed edit" };
    await sync.reconcileExternalEvent(boardEvent("/repo", [updated]), eventCursor(1));
    pending.resolve([closed]);
    await read;
    expect(client.getQueryData(options.queryKey)).toEqual({ tasks: [updated] });
    expect(listAll).toHaveBeenCalledTimes(2);
  } finally {
    pending.resolve([closed]);
    client.clear();
  }
});
