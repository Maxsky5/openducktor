import { sqliteValues } from "./sqlite-parameters";
import type { TaskUpdatePatch } from "@openducktor/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { TaskAssetError } from "../../effect/task-asset-error";
import type {
  NewTaskAssetRecord,
  TaskAssetRecord,
  TaskAssetRegistryPort,
} from "../../ports/task-asset-registry-port";
import type { TaskDescriptionAssetPersistencePort } from "../../ports/task-description-asset-persistence-port";
import { getTaskRecord } from "./sqlite-task-card-read-model";
import { insertTaskFromCreateInput } from "./sqlite-task-create";
import { requireTaskRow } from "./sqlite-task-queries";
import type { SqliteTaskRepositoryContextProvider } from "./sqlite-task-repository-context";
import { type HostDatabaseSession, taskAssets, tasks } from "./sqlite-host-database-schema";
import { commitTaskMutation } from "./sqlite-task-mutation";
import { applyTaskPatch } from "./sqlite-task-writes";
import type { TaskRecord } from "../../ports/task-repository-ports";

export type CreateSqliteTaskAssetRegistryInput = {
  contextProvider: SqliteTaskRepositoryContextProvider;
  now?: () => Date;
};

const toRecord = (row: typeof taskAssets.$inferSelect): TaskAssetRecord => ({
  id: row.id,
  taskId: row.taskId,
  scope: row.scope,
  originalName: row.originalName,
  mediaType: row.mediaType,
  byteSize: row.byteSize,
  createdAt: row.createdAt,
});

const insertAssets = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  assets: NewTaskAssetRecord[],
) => {
  if (assets.length === 0) {
    return Effect.void;
  }
  return session
    .execute(
      (database) =>
        database.insert(taskAssets).values(
          assets.map((asset) => ({
            workspaceId,
            id: asset.id,
            taskId,
            scope: asset.scope,
            originalName: asset.originalName,
            mediaType: asset.mediaType,
            byteSize: asset.byteSize,
            createdAt: asset.createdAt,
          })),
        ),
      "sqliteTaskAssetRegistry.insertAssets",
    )
    .pipe(Effect.asVoid);
};

const sameAssetIds = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right);
  return left.every((assetId) => rightIds.has(assetId));
};

const samePatchedTaskFields = (
  current: TaskRecord,
  expected: TaskRecord,
  patch: TaskUpdatePatch,
): boolean => {
  if (patch.title !== undefined && current.title !== expected.title) return false;
  if (patch.description !== undefined && current.description !== expected.description) return false;
  if (patch.priority !== undefined && current.priority !== expected.priority) return false;
  if (patch.issueType !== undefined && current.issueType !== expected.issueType) return false;
  if (patch.labels !== undefined && !sameAssetIds(current.labels, expected.labels)) return false;
  if (patch.targetBranch !== undefined) {
    if (current.targetBranch?.branch !== expected.targetBranch?.branch) return false;
    if (current.targetBranch?.remote !== expected.targetBranch?.remote) return false;
  }
  return true;
};

export const createSqliteTaskAssetRegistry = ({
  contextProvider: withDatabase,
  now = () => new Date(),
}: CreateSqliteTaskAssetRegistryInput): TaskAssetRegistryPort &
  TaskDescriptionAssetPersistencePort => {
  return {
    taskExists(input) {
      return withDatabase(input, "sqliteTaskAssetRegistry.taskExists", ({ session, workspaceId }) =>
        session
          .execute(
            (database) =>
              database
                .select({ id: tasks.id })
                .from(tasks)
                .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, input.taskId)))
                .limit(1),
            "sqliteTaskAssetRegistry.taskExists.select",
          )
          .pipe(Effect.map((rows) => rows.length > 0)),
      );
    },
    assetIdExists(input) {
      return withDatabase(
        input,
        "sqliteTaskAssetRegistry.assetIdExists",
        ({ session, workspaceId }) =>
          session
            .execute(
              (database) =>
                database
                  .select({ id: taskAssets.id })
                  .from(taskAssets)
                  .where(
                    and(eq(taskAssets.workspaceId, workspaceId), eq(taskAssets.id, input.assetId)),
                  )
                  .limit(1),
              "sqliteTaskAssetRegistry.assetIdExists.select",
            )
            .pipe(Effect.map((rows) => rows.length > 0)),
      );
    },
    getAsset(input) {
      return withDatabase(input, "sqliteTaskAssetRegistry.getAsset", ({ session, workspaceId }) =>
        session
          .execute(
            (database) =>
              database
                .select()
                .from(taskAssets)
                .where(
                  and(
                    eq(taskAssets.workspaceId, workspaceId),
                    eq(taskAssets.id, input.assetId),
                    eq(taskAssets.taskId, input.taskId),
                    eq(taskAssets.scope, input.scope),
                  ),
                )
                .limit(1),
            "sqliteTaskAssetRegistry.getAsset.select",
          )
          .pipe(Effect.map((rows) => (rows[0] ? toRecord(rows[0]) : null))),
      );
    },
    listAssets(input) {
      return withDatabase(input, "sqliteTaskAssetRegistry.listAssets", ({ session, workspaceId }) =>
        session
          .execute(
            (database) =>
              database
                .select()
                .from(taskAssets)
                .where(
                  and(
                    eq(taskAssets.workspaceId, workspaceId),
                    eq(taskAssets.taskId, input.taskId),
                    eq(taskAssets.scope, input.scope),
                  ),
                ),
            "sqliteTaskAssetRegistry.listAssets.select",
          )
          .pipe(Effect.map((rows) => rows.map(toRecord))),
      );
    },
    registerAssets(input) {
      return withDatabase(input, "sqliteTaskAssetRegistry.registerAssets", (context) =>
        commitTaskMutation(context, "sqliteTaskAssetRegistry.registerAssets", (transaction) =>
          Effect.gen(function* () {
            yield* requireTaskRow(transaction, context.workspaceId, input.taskId, input.repoPath);
            yield* insertAssets(transaction, context.workspaceId, input.taskId, input.assets);
            return { value: undefined, taskId: input.taskId };
          }),
        ),
      );
    },
    createTaskWithDescriptionAssets(input) {
      return withDatabase(
        input,
        "sqliteTaskAssetRegistry.createTaskWithDescriptionAssets",
        (context) =>
          commitTaskMutation(
            context,
            "sqliteTaskAssetRegistry.createTaskWithDescriptionAssets",
            (transaction) =>
              Effect.gen(function* () {
                const { workspaceId, taskWorkflows } = context;
                const taskId = yield* insertTaskFromCreateInput({
                  createdAt: now(),
                  session: transaction,
                  status: input.status,
                  task: input.task,
                  workspaceId,
                });
                yield* input.prepareFiles(taskId);
                yield* insertAssets(transaction, workspaceId, taskId, input.assets);
                const value = yield* getTaskRecord(
                  transaction,
                  workspaceId,
                  taskId,
                  input.repoPath,
                  taskWorkflows,
                );
                return { value, taskId };
              }),
          ),
      );
    },
    updateTaskWithDescriptionAssets(input) {
      return withDatabase(
        input,
        "sqliteTaskAssetRegistry.updateTaskWithDescriptionAssets",
        (context) =>
          commitTaskMutation(
            context,
            "sqliteTaskAssetRegistry.updateTaskWithDescriptionAssets",
            (transaction) =>
              Effect.gen(function* () {
                const { workspaceId, taskWorkflows } = context;
                const currentTask = yield* getTaskRecord(
                  transaction,
                  workspaceId,
                  input.taskId,
                  input.repoPath,
                  taskWorkflows,
                );
                const currentAssets = yield* transaction.execute(
                  (database) =>
                    database
                      .select({ id: taskAssets.id })
                      .from(taskAssets)
                      .where(
                        and(
                          eq(taskAssets.workspaceId, workspaceId),
                          eq(taskAssets.taskId, input.taskId),
                          eq(taskAssets.scope, "description"),
                        ),
                      ),
                  "sqliteTaskAssetRegistry.updateTaskWithDescriptionAssets.verifySnapshot",
                );
                const currentAssetIds = currentAssets.map((asset) => asset.id);
                if (
                  !samePatchedTaskFields(currentTask, input.expectedTask, input.patch) ||
                  !sameAssetIds(currentAssetIds, input.expectedAssetIds)
                ) {
                  return yield* new TaskAssetError({
                    operation: "update",
                    code: "validation",
                    taskId: input.taskId,
                    assetIds: currentAssetIds,
                    failedPhase: "verify_update_snapshot",
                    durableState: "unchanged",
                    retryAllowed: true,
                    message: "The task changed while it was being saved. Refresh and try again.",
                  });
                }
                yield* insertAssets(transaction, workspaceId, input.taskId, input.insertAssets);
                if (input.removeAssetIds.length > 0) {
                  yield* transaction.execute(
                    (database) =>
                      database
                        .delete(taskAssets)
                        .where(
                          and(
                            eq(taskAssets.workspaceId, workspaceId),
                            eq(taskAssets.taskId, input.taskId),
                            eq(taskAssets.scope, "description"),
                            inArray(taskAssets.id, sqliteValues(input.removeAssetIds)),
                          ),
                        ),
                    "sqliteTaskAssetRegistry.updateTaskWithDescriptionAssets.deleteAssets",
                  );
                }
                const { task: value } = yield* applyTaskPatch(
                  transaction,
                  workspaceId,
                  { ...input, workspaceId },
                  now(),
                  taskWorkflows,
                );
                return { value, taskId: input.taskId };
              }),
          ),
      );
    },
  };
};
