import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import {
  directMergeRecordSchema,
  gitTargetBranchSchema,
  pullRequestSchema,
} from "@openducktor/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { sqliteValues } from "./sqlite-parameters";
import { normalizeLabels } from "../../domain/task/task-labels";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { validateWithSchema } from "./sqlite-task-store-validation";
import { readTaskLabels, replaceTaskLabels, taskRelationScope } from "./sqlite-task-relations";
import { HostValidationError } from "../../effect/host-errors";
import { requireTaskRow } from "./sqlite-task-queries";
import { getTaskRecord } from "./sqlite-task-card-read-model";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreWriteError,
} from "./sqlite-task-store-errors";
import {
  type TaskInsert,
  type HostDatabaseSession,
  taskDirectMerges,
  taskPullRequests,
  tasks,
} from "./sqlite-host-database-schema";
import { directMergeRowValues, pullRequestRowValues } from "./sqlite-task-delivery-rows";

type SetDirectMergeInput = Parameters<TaskStorePort["setDirectMerge"]>[0];
type SetPullRequestInput = Parameters<TaskStorePort["setPullRequest"]>[0];

/** Runs inside the caller's `BEGIN IMMEDIATE` transaction, so no write can land between the steps. */
export const insertTaskIfAbsent = (
  session: HostDatabaseSession,
  workspaceId: string,
  task: TaskInsert,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    // New IDs are unique across workspaces, so cross-workspace views and links can name one task.
    const existing = yield* session.execute(
      (database) =>
        database.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, task.id)).limit(1),
      "sqliteTaskRepository.createTask.selectTaskId",
      { taskId: task.id },
    );
    if (existing.length > 0) return false;
    yield* session.execute(
      (database) => database.insert(tasks).values({ ...task, workspaceId }),
      "sqliteTaskRepository.createTask.insertTask",
      { taskId: task.id },
    );
    return true;
  });

export const deleteTasks = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskIds: Iterable<string>,
): Effect.Effect<void, SqliteTaskStoreWriteError> =>
  session.execute(
    (database) =>
      database
        .delete(tasks)
        .where(
          and(eq(tasks.workspaceId, workspaceId), inArray(tasks.id, sqliteValues([...taskIds]))),
        ),
    "sqliteTaskRepository.deleteTask.deleteTasks",
  );

export const updateTaskStatus = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: {
    status: TaskInsert["status"];
    taskId: string;
    updatedAt: Date;
  },
): Effect.Effect<void, SqliteTaskStoreWriteError> =>
  session.execute(
    (database) =>
      database
        .update(tasks)
        .set({
          status: input.status,
          updatedAt: input.updatedAt,
        })
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, input.taskId))),
    "sqliteTaskRepository.updateTaskStatus.updateTask",
  );

export const setDirectMergeRecord = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: Pick<SetDirectMergeInput, "directMerge" | "taskId"> & { updatedAt: Date },
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const directMerge =
      input.directMerge === null
        ? null
        : yield* validateWithSchema(directMergeRecordSchema, input.directMerge, "directMergeJson", {
            taskId: input.taskId,
          });
    if (directMerge === null) {
      yield* session.execute(
        (db) =>
          db
            .delete(taskDirectMerges)
            .where(taskRelationScope(taskDirectMerges, workspaceId, input.taskId)),
        "sqliteTaskRepository.setDirectMerge.clear",
      );
    } else {
      yield* session.execute(
        (db) =>
          db
            .delete(taskPullRequests)
            .where(taskRelationScope(taskPullRequests, workspaceId, input.taskId)),
        "sqliteTaskRepository.setDirectMerge.clearPullRequest",
      );
      const values = yield* directMergeRowValues(directMerge);
      yield* session.execute(
        (db) =>
          db
            .insert(taskDirectMerges)
            .values({ workspaceId, taskId: input.taskId, ...values })
            .onConflictDoUpdate({
              target: [taskDirectMerges.workspaceId, taskDirectMerges.taskId],
              set: values,
            }),
        "sqliteTaskRepository.setDirectMerge.upsert",
      );
    }
    yield* session.execute(
      (db) =>
        db
          .update(tasks)
          .set({ updatedAt: input.updatedAt })
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, input.taskId))),
      "sqliteTaskRepository.setDirectMerge.updateTask",
    );
    return true;
  });

export const setPullRequestRecord = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: Pick<SetPullRequestInput, "pullRequest" | "taskId"> & { updatedAt: Date },
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const pullRequest =
      input.pullRequest === null
        ? null
        : yield* validateWithSchema(pullRequestSchema, input.pullRequest, "pullRequestJson", {
            taskId: input.taskId,
          });
    if (pullRequest === null) {
      yield* session.execute(
        (db) =>
          db
            .delete(taskPullRequests)
            .where(taskRelationScope(taskPullRequests, workspaceId, input.taskId)),
        "sqliteTaskRepository.setPullRequest.clear",
      );
    } else {
      yield* session.execute(
        (db) =>
          db
            .delete(taskDirectMerges)
            .where(taskRelationScope(taskDirectMerges, workspaceId, input.taskId)),
        "sqliteTaskRepository.setPullRequest.clearDirectMerge",
      );
      const values = yield* pullRequestRowValues(pullRequest);
      yield* session.execute(
        (db) =>
          db
            .insert(taskPullRequests)
            .values({ workspaceId, taskId: input.taskId, ...values })
            .onConflictDoUpdate({
              target: [taskPullRequests.workspaceId, taskPullRequests.taskId],
              set: values,
            }),
        "sqliteTaskRepository.setPullRequest.upsert",
      );
    }
    yield* session.execute(
      (db) =>
        db
          .update(tasks)
          .set({ updatedAt: input.updatedAt })
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, input.taskId))),
      "sqliteTaskRepository.setPullRequest.updateTask",
    );
    return true;
  });

export const applyTaskPatch = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: Parameters<TaskStorePort["updateTask"]>[0],
  updatedAt: Date,
  taskWorkflows: TaskWorkflowResolver,
) =>
  Effect.gen(function* () {
    const current = yield* requireTaskRow(session, workspaceId, input.taskId, input.repoPath);
    if (
      input.patch.issueType !== undefined &&
      !taskWorkflows.forTask(current).issueTypes.includes(input.patch.issueType)
    )
      return yield* new HostValidationError({
        field: "issueType",
        message: `Issue type ${input.patch.issueType} is not in the current task workflow. Reload the task and choose one of its issue types.`,
      });
    const updates: Partial<TaskInsert> = {};
    if (input.patch.title !== undefined && input.patch.title !== current.title) {
      updates.title = input.patch.title;
    }
    if (input.patch.description !== undefined && input.patch.description !== current.description) {
      updates.description = input.patch.description;
    }
    if (input.patch.priority !== undefined && input.patch.priority !== current.priority) {
      updates.priority = input.patch.priority;
    }
    if (input.patch.issueType !== undefined && input.patch.issueType !== current.issueType) {
      updates.issueType = input.patch.issueType;
    }
    if (
      input.patch.removeWorktreeOnClose !== undefined &&
      input.patch.removeWorktreeOnClose !== current.removeWorktreeOnClose
    ) {
      updates.removeWorktreeOnClose = input.patch.removeWorktreeOnClose;
    }
    if (input.patch.labels !== undefined) {
      const nextLabels = normalizeLabels(input.patch.labels);
      const currentLabels = yield* readTaskLabels(session, workspaceId, input.taskId);
      if (JSON.stringify(nextLabels) !== JSON.stringify(currentLabels)) {
        yield* replaceTaskLabels(session, workspaceId, input.taskId, nextLabels);
        updates.updatedAt = updatedAt;
      }
    }
    if (input.patch.targetBranch !== undefined) {
      const parsed = gitTargetBranchSchema.safeParse(input.patch.targetBranch);
      if (!parsed.success) {
        return yield* new SqliteTaskStoreDataError({
          message: `Invalid SQLite task-store targetBranchJson: ${parsed.error.message}`,
          field: "targetBranchJson",
          details: { taskId: input.taskId },
        });
      }
      const targetBranch = parsed.data;
      if (
        current.targetBranch !== targetBranch.branch ||
        current.targetRemote !== (targetBranch.remote ?? null)
      ) {
        updates.targetBranch = targetBranch.branch;
        updates.targetRemote = targetBranch.remote ?? null;
      }
    }
    if (Object.keys(updates).length > 0) {
      yield* session.execute(
        (database) =>
          database
            .update(tasks)
            .set({ ...updates, updatedAt })
            .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, input.taskId))),
        "sqliteTaskStore.applyTaskPatch.updateTask",
        { taskId: input.taskId },
      );
    }
    const task = yield* getTaskRecord(
      session,
      workspaceId,
      input.taskId,
      input.repoPath,
      taskWorkflows,
    );
    return { task, changed: Object.keys(updates).length > 0 };
  });
