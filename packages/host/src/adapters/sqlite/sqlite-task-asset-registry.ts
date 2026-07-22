import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { TaskAssetError } from "../../effect/task-asset-error";
import type {
  NewTaskAssetRecord,
  TaskAssetRecord,
  TaskAssetRegistryPort,
} from "../../ports/task-asset-registry-port";
import type { TaskDescriptionAssetPersistencePort } from "../../ports/task-description-asset-persistence-port";
import { getTaskCard } from "./sqlite-task-card-read-model";
import { requireTaskRow } from "./sqlite-task-queries";
import {
  createSqliteTaskRepositoryContextProvider,
  type ResolveSqliteTaskStorePath,
  type ResolveWorkspaceIdForRepoPath,
} from "./sqlite-task-repository-context";
import { type TaskStoreSession, taskAssets, tasks } from "./sqlite-task-store-schema";
import { applyTaskPatch } from "./sqlite-task-writes";

export type CreateSqliteTaskAssetRegistryInput = {
  now?: () => Date;
  processEnv?: NodeJS.ProcessEnv;
  resolveDatabasePath?: ResolveSqliteTaskStorePath;
  resolveWorkspaceIdForRepoPath: ResolveWorkspaceIdForRepoPath;
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

const insertAssets = (session: TaskStoreSession, taskId: string, assets: NewTaskAssetRecord[]) => {
  if (assets.length === 0) {
    return Effect.void;
  }
  return session
    .execute(
      (database) =>
        database.insert(taskAssets).values(
          assets.map((asset) => ({
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

export const createSqliteTaskAssetRegistry = ({
  now = () => new Date(),
  processEnv = process.env,
  resolveDatabasePath,
  resolveWorkspaceIdForRepoPath,
}: CreateSqliteTaskAssetRegistryInput): TaskAssetRegistryPort &
  TaskDescriptionAssetPersistencePort => {
  const withDatabase = createSqliteTaskRepositoryContextProvider({
    processEnv,
    ...(resolveDatabasePath ? { resolveDatabasePath } : {}),
    resolveWorkspaceIdForRepoPath,
  });

  return {
    taskExists(input) {
      return withDatabase(input.repoPath, "sqliteTaskAssetRegistry.taskExists", ({ session }) =>
        session
          .execute(
            (database) =>
              database
                .select({ id: tasks.id })
                .from(tasks)
                .where(eq(tasks.id, input.taskId))
                .limit(1),
            "sqliteTaskAssetRegistry.taskExists.select",
          )
          .pipe(Effect.map((rows) => rows.length > 0)),
      );
    },
    assetIdExists(input) {
      return withDatabase(input.repoPath, "sqliteTaskAssetRegistry.assetIdExists", ({ session }) =>
        session
          .execute(
            (database) =>
              database
                .select({ id: taskAssets.id })
                .from(taskAssets)
                .where(eq(taskAssets.id, input.assetId))
                .limit(1),
            "sqliteTaskAssetRegistry.assetIdExists.select",
          )
          .pipe(Effect.map((rows) => rows.length > 0)),
      );
    },
    getAsset(input) {
      return withDatabase(input.repoPath, "sqliteTaskAssetRegistry.getAsset", ({ session }) =>
        session
          .execute(
            (database) =>
              database
                .select()
                .from(taskAssets)
                .where(
                  and(
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
      return withDatabase(input.repoPath, "sqliteTaskAssetRegistry.listAssets", ({ session }) =>
        session
          .execute(
            (database) =>
              database
                .select()
                .from(taskAssets)
                .where(and(eq(taskAssets.taskId, input.taskId), eq(taskAssets.scope, input.scope))),
            "sqliteTaskAssetRegistry.listAssets.select",
          )
          .pipe(Effect.map((rows) => rows.map(toRecord))),
      );
    },
    registerAssets(input) {
      return withDatabase(input.repoPath, "sqliteTaskAssetRegistry.registerAssets", ({ session }) =>
        session.transaction("sqliteTaskAssetRegistry.registerAssets", (transaction) =>
          Effect.gen(function* () {
            yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            yield* insertAssets(transaction, input.taskId, input.assets);
          }),
        ),
      );
    },
    updateTaskWithDescriptionAssets(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskAssetRegistry.updateTaskWithDescriptionAssets",
        ({ session }) =>
          session.transaction(
            "sqliteTaskAssetRegistry.updateTaskWithDescriptionAssets",
            (transaction) =>
              Effect.gen(function* () {
                const task = yield* requireTaskRow(transaction, input.taskId, input.repoPath);
                const currentAssets = yield* transaction.execute(
                  (database) =>
                    database
                      .select({ id: taskAssets.id })
                      .from(taskAssets)
                      .where(
                        and(
                          eq(taskAssets.taskId, input.taskId),
                          eq(taskAssets.scope, "description"),
                        ),
                      ),
                  "sqliteTaskAssetRegistry.updateTaskWithDescriptionAssets.verifySnapshot",
                );
                const currentAssetIds = currentAssets.map((asset) => asset.id);
                if (
                  (task.description ?? "") !== input.expectedDescription ||
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
                    message:
                      "The task description changed while it was being saved. Refresh the task and try again.",
                  });
                }
                yield* insertAssets(transaction, input.taskId, input.insertAssets);
                if (input.removeAssetIds.length > 0) {
                  yield* transaction.execute(
                    (database) =>
                      database
                        .delete(taskAssets)
                        .where(
                          and(
                            eq(taskAssets.taskId, input.taskId),
                            eq(taskAssets.scope, "description"),
                            inArray(taskAssets.id, input.removeAssetIds),
                          ),
                        ),
                    "sqliteTaskAssetRegistry.updateTaskWithDescriptionAssets.deleteAssets",
                  );
                }
                yield* applyTaskPatch(transaction, input, now());
                return yield* getTaskCard(transaction, input.taskId, input.repoPath);
              }),
          ),
      );
    },
  };
};
