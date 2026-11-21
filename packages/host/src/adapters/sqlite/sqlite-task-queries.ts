import { TASK_CLOSED_STATE } from "@openducktor/contracts";
import { taskTargetBranchFromRow } from "./sqlite-task-store-validation";
import type { TaskWorkflowVersionCache } from "../../ports/task-workflow-port";
import {
  loadTaskWorkflowVersions,
  taskVersionPublishedAtMs,
} from "./sqlite-task-workflow-versions";
import { and, asc, desc, eq, getTableColumns, ne, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import type { TaskReference } from "../../ports/task-repository-ports";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import {
  type TaskRow,
  type HostDatabaseSession,
  taskDirectMerges,
  taskIssueLinks,
  taskPullRequests,
  tasks,
} from "./sqlite-host-database-schema";

export type TaskCardRow = {
  task: TaskRow;
  /** The `published_at_ms` of the stored version of the task, for the version cache. */
  workflowPublishedAtMs: number | null;
  labels: string[];
  pullRequest: typeof taskPullRequests.$inferSelect | null;
  directMerge: typeof taskDirectMerges.$inferSelect | null;
  sourceIssue: typeof taskIssueLinks.$inferSelect | null;
};

const taskLaneOrderBy = [
  // Open tasks are backlog-priority ordered; every other lane keeps newer activity last.
  asc(sql`case when ${tasks.status} = 'open' then 0 else 1 end`),
  asc(sql`case when ${tasks.status} = 'open' then ${tasks.priority} else 0 end`),
  desc(sql`case when ${tasks.status} = 'open' then ${tasks.createdAt} else 0 end`),
  asc(sql`case when ${tasks.status} <> 'open' then ${tasks.updatedAt} else 0 end`),
  asc(tasks.id),
] as const;

export const listTaskIdsInDatabase = (
  session: HostDatabaseSession,
  workspaceId: string,
): Effect.Effect<string[], SqliteTaskStoreReadError> =>
  session
    .execute(
      (database) =>
        database
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.workspaceId, workspaceId))
          .orderBy(...taskLaneOrderBy),
      "sqliteTaskStore.listTaskIds.selectTasks",
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.id)));

export const listDirectMergeTaskIdsInDatabase = (
  session: HostDatabaseSession,
  workspaceId: string,
): Effect.Effect<string[], SqliteTaskStoreReadError> =>
  session
    .execute(
      (database) =>
        database
          .select({ id: taskDirectMerges.taskId })
          .from(taskDirectMerges)
          .where(eq(taskDirectMerges.workspaceId, workspaceId)),
      "sqliteTaskStore.listDirectMergeTaskIds.selectTasks",
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.id)));

export const taskCardRows = (
  session: HostDatabaseSession,
  workspaceId: string,
  where?: SQL | undefined,
): Effect.Effect<TaskCardRow[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select({
            task: tasks,
            workflowPublishedAtMs: taskVersionPublishedAtMs,
            pullRequest: taskPullRequests,
            directMerge: taskDirectMerges,
            sourceIssue: taskIssueLinks,
            labels: sql<string>`(select json_group_array(label) from (
              select label from task_labels
              where workspace_id = ${tasks.workspaceId} and task_id = ${tasks.id}
              order by position
            ))`.mapWith(JSON.parse),
          })
          .from(tasks)
          .leftJoin(
            taskPullRequests,
            and(
              eq(taskPullRequests.workspaceId, tasks.workspaceId),
              eq(taskPullRequests.taskId, tasks.id),
            ),
          )
          .leftJoin(
            taskDirectMerges,
            and(
              eq(taskDirectMerges.workspaceId, tasks.workspaceId),
              eq(taskDirectMerges.taskId, tasks.id),
            ),
          )
          .leftJoin(
            taskIssueLinks,
            and(
              eq(taskIssueLinks.workspaceId, tasks.workspaceId),
              eq(taskIssueLinks.taskId, tasks.id),
            ),
          )
          .where(and(eq(tasks.workspaceId, workspaceId), where))
          .orderBy(...taskLaneOrderBy),
      "sqliteTaskStore.taskCardRows.selectTasks",
    );
    return rows;
  });

export const mergeCandidates = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskWorkflows: TaskWorkflowVersionCache,
) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (db) =>
        db
          .select({
            workspaceId: tasks.workspaceId,
            id: tasks.id,
            status: tasks.status,
            workflowId: tasks.workflowId,
            workflowVersion: tasks.workflowVersion,
            workflowPublishedAtMs: taskVersionPublishedAtMs,
            targetBranch: tasks.targetBranch,
            targetRemote: tasks.targetRemote,
          })
          .from(tasks)
          .where(and(eq(tasks.workspaceId, workspaceId), ne(tasks.status, TASK_CLOSED_STATE)))
          .orderBy(...taskLaneOrderBy),
      "sqliteTaskStore.mergeCandidates.selectTasks",
    );
    yield* loadTaskWorkflowVersions(session, taskWorkflows, rows);
    const checked = rows.filter((row) => taskWorkflows.forTask(row).detectsMerge(row.status));
    return yield* Effect.forEach(checked, (row) =>
      Effect.gen(function* () {
        const targetBranch = yield* taskTargetBranchFromRow(row, workspaceId);
        return { id: row.id, status: row.status, targetBranch };
      }),
    );
  });

export const taskReferenceCandidates = (
  session: HostDatabaseSession,
  workspaceId: string,
): Effect.Effect<TaskReference[], SqliteTaskStoreReadError> =>
  session.execute(
    (database) =>
      database
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(eq(tasks.workspaceId, workspaceId))
        .orderBy(...taskLaneOrderBy),
    "sqliteTaskStore.taskReferenceCandidates.selectTasks",
  );

/** A task row with the `published_at_ms` of its stored version, for the version cache. */
export type StampedTaskRow = TaskRow & { workflowPublishedAtMs: number | null };

const getTaskRow = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
): Effect.Effect<StampedTaskRow | null, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select({ ...getTableColumns(tasks), workflowPublishedAtMs: taskVersionPublishedAtMs })
          .from(tasks)
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, taskId)))
          .limit(1),
      "sqliteTaskStore.getTaskRow.selectTask",
      { taskId },
    );
    return rows[0] ?? null;
  });

export const requireTaskRow = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  repoPath: string,
): Effect.Effect<StampedTaskRow, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const row = yield* getTaskRow(session, workspaceId, taskId);
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
