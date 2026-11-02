import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { taskRowFixture } from "./sqlite-task-row-test-fixtures";
import { firstTaskIdHashLength } from "./sqlite-task-ids";
import { tasks, taskIssueLinks } from "./sqlite-host-database-schema";
import { createSqliteTaskStoreHarness } from "./sqlite-task-store-test-support";

describe("SQLite task IDs", () => {
  test("initializes an empty store and rejects reads after disposal", async () => {
    const { cleanup, scope, store } = await createSqliteTaskStoreHarness();
    try {
      expect(await Effect.runPromise(store.listTaskIds(scope))).toEqual([]);
    } finally {
      await cleanup();
    }

    expect(await Effect.runPromise(Effect.flip(store.listTaskIds(scope)))).toMatchObject({
      _tag: "HostOperationError",
    });
  });

  test("keeps card ordering, ID ties, and old closed tasks", async () => {
    const { cleanup, scope, store, contextProvider } = await createSqliteTaskStoreHarness();
    const older = new Date("2020-01-01T00:00:00.000Z");
    const newer = new Date("2020-01-02T00:00:00.000Z");
    const rows = [
      taskRowFixture({ id: "open-low", priority: 4, createdAt: newer }),
      taskRowFixture({ id: "open-older", priority: 1, createdAt: older }),
      taskRowFixture({ id: "open-newer-b", priority: 1, createdAt: newer }),
      taskRowFixture({ id: "open-newer-a", priority: 1, createdAt: newer }),
      taskRowFixture({ id: "active-newer", status: "in_progress", updatedAt: newer }),
      taskRowFixture({ id: "closed-b", status: "closed", updatedAt: older }),
      taskRowFixture({ id: "closed-a", status: "closed", updatedAt: older }),
    ];
    try {
      await Effect.runPromise(
        contextProvider(scope, "test.seedTasks", ({ session }) =>
          session.execute((database) => database.insert(tasks).values(rows), "test.seedTasks"),
        ),
      );

      const ids = await Effect.runPromise(store.listTaskIds(scope));
      expect(ids).toEqual([
        "open-newer-a",
        "open-newer-b",
        "open-older",
        "open-low",
        "closed-a",
        "closed-b",
        "active-newer",
      ]);
      const cards = await Effect.runPromise(store.listTasks(scope));
      expect(ids).toEqual(cards.map((task) => task.id));
      const visible = await Effect.runPromise(store.listTasks({ ...scope, doneVisibleDays: 1 }));
      expect(visible.map((task) => task.id)).not.toContain("closed-a");

      await Effect.runPromise(store.deleteTask({ ...scope, taskId: "closed-a" }));
      expect(await Effect.runPromise(store.listTaskIds(scope))).toEqual(
        ids.filter((id) => id !== "closed-a"),
      );
    } finally {
      await cleanup();
    }
  });

  test("reads IDs without decoding invalid card fields", async () => {
    const { cleanup, scope, store, contextProvider } = await createSqliteTaskStoreHarness();
    try {
      await Effect.runPromise(
        contextProvider(scope, "test.seedTask", ({ session }) =>
          session.execute(
            (database) => database.insert(tasks).values(taskRowFixture()),
            "test.seedTask",
          ),
        ),
      );

      await Effect.runPromise(
        contextProvider(scope, "test.invalidIssue", ({ session, workspaceId }) =>
          session.execute(
            (db) =>
              db.insert(taskIssueLinks).values({
                workspaceId,
                taskId: "task-1",
                providerId: "github",
                providerScope: "repo",
                externalId: "1",
                displayNumber: "1",
                url: "invalid",
              }),
            "test.invalidIssue",
          ),
        ),
      );
      expect(await Effect.runPromise(store.listTaskIds(scope))).toEqual(["task-1"]);
      await expect(Effect.runPromise(store.listTasks(scope))).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  test("keeps the ID length thresholds and caps the matching count", async () => {
    const harness = await createSqliteTaskStoreHarness();
    try {
      await Effect.runPromise(
        harness.contextProvider(harness.scope, "test.thresholds", ({ session, workspaceId }) =>
          Effect.gen(function* () {
            for (const [count, length] of [
              [99, 4],
              [100, 5],
              [999, 5],
              [1000, 6],
              [9999, 6],
              [10000, 7],
              [20000, 7],
            ] as const) {
              yield* session.execute((db) => db.delete(tasks), "test.clear");
              yield* session.execute(
                (db) =>
                  db.run(
                    sql`with recursive n(i) as (select 1 union all select i+1 from n where i < ${count}) insert into tasks (workspace_id,id,title,status,issue_type,priority,created_at_ms,updated_at_ms) select ${workspaceId}, 'prefix-'||i, 'Task', 'open', 'task', 2, 0, 0 from n`,
                  ),
                "test.seed",
              );
              expect(yield* firstTaskIdHashLength(session, "prefix")).toBe(length);
              expect(yield* firstTaskIdHashLength(session, "other")).toBe(4);
            }
          }),
        ),
      );
    } finally {
      await harness.cleanup();
    }
  });

  test("returns a typed error when the ID query fails", async () => {
    const { cleanup, scope, store, contextProvider } = await createSqliteTaskStoreHarness();
    try {
      await Effect.runPromise(
        contextProvider(scope, "test.breakTaskTable", ({ session }) =>
          session.execute((database) => database.run(sql`DROP TABLE tasks`), "test.breakTaskTable"),
        ),
      );

      expect(await Effect.runPromise(Effect.flip(store.listTaskIds(scope)))).toMatchObject({
        _tag: "HostOperationError",
        operation: "sqliteTaskStore.listTaskIds.selectTasks",
      });
    } finally {
      await cleanup();
    }
  });
});
