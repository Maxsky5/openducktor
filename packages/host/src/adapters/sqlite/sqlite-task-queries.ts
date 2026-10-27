import { asc, desc, eq, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import type { TaskReference } from "../../ports/task-repository-ports";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import { type TaskRow, type TaskStoreSession, tasks } from "./sqlite-task-store-schema";

const taskLaneOrderBy = [
  // Open tasks are backlog-priority ordered; every other lane keeps newer activity last.
  asc(sql`case when ${tasks.status} = 'open' then 0 else 1 end`),
  asc(sql`case when ${tasks.status} = 'open' then ${tasks.priority} else 0 end`),
  desc(sql`case when ${tasks.status} = 'open' then ${tasks.createdAt} else 0 end`),
  asc(sql`case when ${tasks.status} <> 'open' then ${tasks.updatedAt} else 0 end`),
  asc(tasks.id),
] as const;

export const listTaskIdsInDatabase = (
  session: TaskStoreSession,
): Effect.Effect<string[], SqliteTaskStoreReadError> =>
  session
    .execute(
      (database) =>
        database
          .select({ id: tasks.id })
          .from(tasks)
          .orderBy(...taskLaneOrderBy),
      "sqliteTaskStore.listTaskIds.selectTasks",
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.id)));

export const taskRows = (
  session: TaskStoreSession,
  where?: SQL | undefined,
): Effect.Effect<TaskRow[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows =
      where === undefined
        ? yield* session.execute(
            (database) =>
              database
                .select()
                .from(tasks)
                .orderBy(...taskLaneOrderBy),
            "sqliteTaskStore.taskRows.selectTasks",
          )
        : yield* session.execute(
            (database) =>
              database
                .select()
                .from(tasks)
                .where(where)
                .orderBy(...taskLaneOrderBy),
            "sqliteTaskStore.taskRows.selectTasks",
          );
    return rows;
  });

export const taskReferenceCandidates = (
  session: TaskStoreSession,
): Effect.Effect<TaskReference[], SqliteTaskStoreReadError> =>
  session.execute(
    (database) =>
      database
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .orderBy(...taskLaneOrderBy),
    "sqliteTaskStore.taskReferenceCandidates.selectTasks",
  );

export const getTaskRow = (
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
