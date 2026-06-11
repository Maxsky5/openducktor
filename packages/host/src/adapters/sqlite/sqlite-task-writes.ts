import {
  directMergeRecordSchema,
  gitTargetBranchSchema,
  pullRequestSchema,
} from "@openducktor/contracts";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { decodeWithSchema, encodeJson, normalizeLabels } from "./sqlite-json-codecs";
import { getTaskCard } from "./sqlite-task-card-read-model";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreWriteError,
} from "./sqlite-task-store-errors";
import { type TaskInsert, type TaskStoreSession, tasks } from "./sqlite-task-store-schema";

type SetDirectMergeInput = Parameters<TaskStorePort["setDirectMerge"]>[0];
type SetPullRequestInput = Parameters<TaskStorePort["setPullRequest"]>[0];

export const insertTaskIfAbsent = (
  session: TaskStoreSession,
  task: TaskInsert,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .insert(tasks)
          .values(task)
          .onConflictDoNothing({ target: tasks.id })
          .returning({ id: tasks.id }),
      "sqliteTaskRepository.createTask.insertTaskIfAbsent",
      { taskId: task.id },
    );
    return rows.length > 0;
  });

export const deleteTasks = (
  session: TaskStoreSession,
  taskIds: Iterable<string>,
): Effect.Effect<void, SqliteTaskStoreWriteError> =>
  session.execute(
    (database) => database.delete(tasks).where(inArray(tasks.id, Array.from(taskIds))),
    "sqliteTaskRepository.deleteTask.deleteTasks",
  );

export const updateTaskStatus = (
  session: TaskStoreSession,
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
        .set({ status: input.status, updatedAt: input.updatedAt })
        .where(eq(tasks.id, input.taskId)),
    "sqliteTaskRepository.updateTaskStatus.updateTask",
  );

export const setDirectMergeRecord = (
  session: TaskStoreSession,
  input: Pick<SetDirectMergeInput, "directMerge" | "taskId"> & { updatedAt: Date },
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const directMerge =
      input.directMerge === null
        ? null
        : yield* decodeWithSchema(directMergeRecordSchema, input.directMerge, "directMergeJson", {
            taskId: input.taskId,
          });
    if (directMerge === null) {
      yield* session.execute(
        (database) =>
          database
            .update(tasks)
            .set({ directMergeJson: null, updatedAt: input.updatedAt })
            .where(eq(tasks.id, input.taskId)),
        "sqliteTaskRepository.setDirectMerge.clearDirectMerge",
      );
      return true;
    }
    yield* session.execute(
      (database) =>
        database
          .update(tasks)
          .set({
            directMergeJson: encodeJson(directMerge),
            pullRequestJson: null,
            updatedAt: input.updatedAt,
          })
          .where(eq(tasks.id, input.taskId)),
      "sqliteTaskRepository.setDirectMerge.updateTask",
    );
    return true;
  });

export const setPullRequestRecord = (
  session: TaskStoreSession,
  input: Pick<SetPullRequestInput, "pullRequest" | "taskId"> & { updatedAt: Date },
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const pullRequest =
      input.pullRequest === null
        ? null
        : yield* decodeWithSchema(pullRequestSchema, input.pullRequest, "pullRequestJson", {
            taskId: input.taskId,
          });
    if (pullRequest === null) {
      yield* session.execute(
        (database) =>
          database
            .update(tasks)
            .set({ pullRequestJson: null, updatedAt: input.updatedAt })
            .where(eq(tasks.id, input.taskId)),
        "sqliteTaskRepository.setPullRequest.clearPullRequest",
      );
      return true;
    }
    yield* session.execute(
      (database) =>
        database
          .update(tasks)
          .set({
            directMergeJson: null,
            pullRequestJson: encodeJson(pullRequest),
            updatedAt: input.updatedAt,
          })
          .where(eq(tasks.id, input.taskId)),
      "sqliteTaskRepository.setPullRequest.updateTask",
    );
    return true;
  });

export const applyTaskPatch = (
  session: TaskStoreSession,
  input: Parameters<TaskStorePort["updateTask"]>[0],
  updatedAt: Date,
) =>
  Effect.gen(function* () {
    const updates: Partial<TaskInsert> = {};
    if (input.patch.title !== undefined) {
      updates.title = input.patch.title;
    }
    if (input.patch.description !== undefined) {
      updates.description = input.patch.description;
    }
    if (input.patch.priority !== undefined) {
      updates.priority = input.patch.priority;
    }
    if (input.patch.issueType !== undefined) {
      updates.issueType = input.patch.issueType;
    }
    if (input.patch.aiReviewEnabled !== undefined) {
      updates.qaRequired = input.patch.aiReviewEnabled ? 1 : 0;
    }
    if (input.patch.labels !== undefined) {
      updates.labelsJson = encodeJson(normalizeLabels(input.patch.labels));
    }
    if (input.patch.parentId !== undefined) {
      const parentId = input.patch.parentId.trim();
      updates.parentId = parentId.length > 0 ? parentId : null;
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
      updates.targetBranchJson = encodeJson(targetBranch);
    }
    if (Object.keys(updates).length > 0) {
      yield* session.execute(
        (database) =>
          database
            .update(tasks)
            .set({ ...updates, updatedAt })
            .where(eq(tasks.id, input.taskId)),
        "sqliteTaskStore.applyTaskPatch.updateTask",
        { taskId: input.taskId },
      );
    }
    return yield* getTaskCard(session, input.taskId, input.repoPath);
  });
