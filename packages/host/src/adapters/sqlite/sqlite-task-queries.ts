import { asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { Effect } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import { type TaskRow, type TaskStoreSession, tasks } from "./sqlite-task-store-schema";

export const taskRows = (
  session: TaskStoreSession,
  where?: SQL | undefined,
): Effect.Effect<TaskRow[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows =
      where === undefined
        ? yield* session.execute(
            (database) =>
              database.select().from(tasks).orderBy(desc(tasks.updatedAt), asc(tasks.id)),
            "sqliteTaskStore.taskRows.selectTasks",
          )
        : yield* session.execute(
            (database) =>
              database
                .select()
                .from(tasks)
                .where(where)
                .orderBy(desc(tasks.updatedAt), asc(tasks.id)),
            "sqliteTaskStore.taskRows.selectTasks",
          );
    return rows;
  });

const getTaskRow = (
  session: TaskStoreSession,
  taskId: string,
): Effect.Effect<TaskRow | null, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) => database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1),
      "sqliteTaskStore.getTaskRow.selectTask",
      { taskId },
    );
    return rows[0] ?? null;
  });

export const requireTaskRow = (
  session: TaskStoreSession,
  taskId: string,
  repoPath: string,
): Effect.Effect<TaskRow, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const row = yield* getTaskRow(session, taskId);
    if (!row) {
      return yield* new HostResourceError({
        resource: "task",
        operation: "sqliteTaskRepository.getTask",
        message: `Task not found: ${taskId}`,
        details: { repoPath, taskId },
      });
    }
    return row;
  });

export const descendantTaskIds = (
  session: TaskStoreSession,
  rootTaskId: string,
): Effect.Effect<Set<string>, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const targetIds = new Set<string>([rootTaskId]);
    let changed = true;
    while (changed) {
      changed = false;
      const childRows = yield* session.execute(
        (database) =>
          database
            .select({ id: tasks.id })
            .from(tasks)
            .where(inArray(tasks.parentId, Array.from(targetIds))),
        "sqliteTaskStore.descendantTaskIds.selectChildren",
        { rootTaskId },
      );
      for (const child of childRows) {
        if (!targetIds.has(child.id)) {
          targetIds.add(child.id);
          changed = true;
        }
      }
    }
    return targetIds;
  });
