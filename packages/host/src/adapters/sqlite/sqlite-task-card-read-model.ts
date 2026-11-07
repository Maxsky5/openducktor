import { sqliteValues } from "./sqlite-parameters";
import {
  gitTargetBranchSchema,
  type TaskArtifactSummary,
  TASK_CLOSED_STATE,
  taskRecordDataSchema,
} from "@openducktor/contracts";
import { type SQL, eq, inArray, gte, or, ne } from "drizzle-orm";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { Effect } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import { normalizeLabels } from "../../domain/task/task-labels";
import type { TaskRecord, TaskStoreListTasksInput } from "../../ports/task-repository-ports";
import { validateWithSchema } from "./sqlite-task-store-validation";
import { artifactSummariesByTaskId } from "./sqlite-task-workflow-artifact-queries";
import { taskCardRows, type TaskCardRow } from "./sqlite-task-queries";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import { type HostDatabaseSession, tasks } from "./sqlite-host-database-schema";
import { directMergeFromRow, pullRequestFromRow } from "./sqlite-task-delivery-rows";

const taskRecordSchema = taskRecordDataSchema;

export const getTaskRecord = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  repoPath: string,
  taskWorkflows: TaskWorkflowResolver,
): Effect.Effect<TaskRecord, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const task = yield* findTaskRecord(session, workspaceId, taskId, taskWorkflows);
    if (task === null) {
      return yield* new HostResourceError({
        resource: "task",
        operation: "sqliteTaskRepository.getTask",
        message: `Task not found: ${taskId}`,
        details: { repoPath, taskId },
      });
    }
    return task;
  });

export const findTaskRecord = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  taskWorkflows: TaskWorkflowResolver,
): Effect.Effect<TaskRecord | null, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* taskCardRows(session, workspaceId, eq(tasks.id, taskId));
    const cards = yield* rowsToTaskRecords(session, workspaceId, rows, taskWorkflows);
    return cards[0] ?? null;
  });

/** A Kanban list hides tasks in terminal states after the done visible days. */
export const listTasksInDatabase = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: TaskStoreListTasksInput,
  now: () => Date,
  taskWorkflows: TaskWorkflowResolver,
): Effect.Effect<TaskRecord[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    if (input.taskIds !== undefined) {
      return yield* readChangedCards(session, workspaceId, input.taskIds, taskWorkflows);
    }
    let where: SQL | undefined;
    if (input.doneVisibleDays !== undefined) {
      const cutoff = new Date(now().getTime() - input.doneVisibleDays * 24 * 60 * 60 * 1000);
      const open = ne(tasks.status, TASK_CLOSED_STATE);
      where = input.doneVisibleDays > 0 ? or(open, gte(tasks.updatedAt, cutoff)) : open;
    }
    return yield* rowsToTaskRecords(
      session,
      workspaceId,
      yield* taskCardRows(session, workspaceId, where),
      taskWorkflows,
    );
  });

const readChangedCards = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskIds: readonly string[],
  taskWorkflows: TaskWorkflowResolver,
): Effect.Effect<TaskRecord[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    if (taskIds.length === 0) return [];
    const rows = yield* taskCardRows(
      session,
      workspaceId,
      inArray(tasks.id, sqliteValues([...taskIds])),
    );
    return yield* rowsToTaskRecords(session, workspaceId, rows, taskWorkflows);
  });

const rowsToTaskRecords = (
  session: HostDatabaseSession,
  workspaceId: string,
  rows: readonly TaskCardRow[],
  taskWorkflows: TaskWorkflowResolver,
): Effect.Effect<TaskRecord[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const workflows = new Map(rows.map(({ task }) => [task.id, taskWorkflows.forTask(task)]));
    const summaries = yield* artifactSummariesByTaskId(session, workspaceId, workflows);
    return yield* Effect.forEach(rows, (row) => rowToTaskRecord(row, summaries.get(row.task.id)));
  });

const rowToTaskRecord = (
  { task: row, labels, pullRequest, directMerge, sourceIssue }: TaskCardRow,
  artifactSummary: TaskArtifactSummary | undefined,
): Effect.Effect<TaskRecord, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const targetBranch =
      row.targetBranch === null
        ? undefined
        : yield* validateWithSchema(
            gitTargetBranchSchema,
            { branch: row.targetBranch, remote: row.targetRemote ?? undefined },
            "target branch",
            { workspaceId: row.workspaceId, taskId: row.id },
          );
    const taskCard = {
      createdAt: row.createdAt.toISOString(),
      description: row.description ?? "",
      artifactSummary,
      id: row.id,
      issueType: row.issueType,
      labels: normalizeLabels(labels),
      priority: row.priority,
      pullRequest: pullRequest === null ? undefined : pullRequestFromRow(pullRequest),
      directMerge: directMerge === null ? undefined : directMergeFromRow(directMerge),
      sourceIssue:
        sourceIssue === null
          ? undefined
          : {
              providerId: sourceIssue.providerId,
              scope: sourceIssue.providerScope,
              sourceId: sourceIssue.externalId,
              number: sourceIssue.displayNumber,
              url: sourceIssue.url,
            },
      status: row.status,
      targetBranch,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
      removeWorktreeOnClose: row.removeWorktreeOnClose,
    };
    return yield* validateWithSchema(taskRecordSchema, taskCard, "task card read model", {
      taskId: row.id,
    });
  });
