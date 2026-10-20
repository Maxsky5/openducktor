import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { taskRowFixture } from "./sqlite-task-row-test-fixtures";
import { tasks } from "./sqlite-task-store-schema";
import { createSqliteTaskStoreHarness } from "./sqlite-task-store-test-support";

describe("SQLite task IDs", () => {
  test("initializes an empty store and rejects reads after disposal", async () => {
    const harness = await createSqliteTaskStoreHarness();
    try {
      expect(
        await Effect.runPromise(harness.store.listTaskIds({ repoPath: harness.repoPath })),
      ).toEqual([]);
    } finally {
      await harness.cleanup();
    }

    expect(
      await Effect.runPromise(
        Effect.flip(harness.store.listTaskIds({ repoPath: harness.repoPath })),
      ),
    ).toMatchObject({
      _tag: "HostOperationError",
    });
  });

  test("keeps card ordering, ID ties, subtasks, and old closed tasks", async () => {
    const harness = await createSqliteTaskStoreHarness();
    const { repoPath, store, contextProvider } = harness;
    const older = new Date("2020-01-01T00:00:00.000Z");
    const newer = new Date("2020-01-02T00:00:00.000Z");
    const rows = [
      taskRowFixture({ id: "open-low", priority: 4, createdAt: newer }),
      taskRowFixture({ id: "open-older", priority: 1, createdAt: older }),
      taskRowFixture({ id: "open-newer-b", priority: 1, createdAt: newer }),
      taskRowFixture({ id: "open-newer-a", priority: 1, createdAt: newer }),
      taskRowFixture({ id: "active-newer", status: "in_progress", updatedAt: newer }),
      taskRowFixture({ id: "closed-b", status: "closed", updatedAt: older }),
      taskRowFixture({
        id: "closed-a",
        status: "closed",
        parentId: "open-low",
        updatedAt: older,
      }),
    ];
    try {
      await Effect.runPromise(
        contextProvider(repoPath, "test.seedTasks", ({ session }) =>
          session.execute((database) => database.insert(tasks).values(rows), "test.seedTasks"),
        ),
      );

      const ids = await Effect.runPromise(store.listTaskIds({ repoPath }));
      expect(ids).toEqual([
        "open-newer-a",
        "open-newer-b",
        "open-older",
        "open-low",
        "closed-a",
        "closed-b",
        "active-newer",
      ]);
      const cards = await Effect.runPromise(store.listTasks({ repoPath }));
      expect(ids).toEqual(cards.map((task) => task.id));
      const visible = await Effect.runPromise(store.listTasks({ repoPath, doneVisibleDays: 1 }));
      expect(visible.map((task) => task.id)).not.toContain("closed-a");

      await Effect.runPromise(
        store.deleteTask({ repoPath, taskId: "closed-a", deleteSubtasks: false }),
      );
      expect(await Effect.runPromise(store.listTaskIds({ repoPath }))).toEqual(
        ids.filter((id) => id !== "closed-a"),
      );
    } finally {
      await harness.cleanup();
    }
  });

  test("reads IDs without decoding task card JSON", async () => {
    const harness = await createSqliteTaskStoreHarness();
    try {
      await Effect.runPromise(
        harness.contextProvider(harness.repoPath, "test.seedTask", ({ session }) =>
          session.execute(
            (database) => database.insert(tasks).values(taskRowFixture({ labelsJson: "invalid" })),
            "test.seedTask",
          ),
        ),
      );

      expect(
        await Effect.runPromise(harness.store.listTaskIds({ repoPath: harness.repoPath })),
      ).toEqual(["task-1"]);
      await expect(
        Effect.runPromise(harness.store.listTasks({ repoPath: harness.repoPath })),
      ).rejects.toThrow();
    } finally {
      await harness.cleanup();
    }
  });

  test("returns a typed error when the ID query fails", async () => {
    const harness = await createSqliteTaskStoreHarness();
    try {
      await Effect.runPromise(
        harness.contextProvider(harness.repoPath, "test.breakTaskTable", ({ session }) =>
          session.execute((database) => database.run(sql`DROP TABLE tasks`), "test.breakTaskTable"),
        ),
      );

      expect(
        await Effect.runPromise(
          Effect.flip(harness.store.listTaskIds({ repoPath: harness.repoPath })),
        ),
      ).toMatchObject({
        _tag: "HostOperationError",
        operation: "sqliteTaskStore.listTaskIds.selectTasks",
      });
    } finally {
      await harness.cleanup();
    }
  });
});
