import { stat } from "node:fs/promises";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import { listRuntimeSessionOwners } from "./sqlite-runtime-session-owners";
import { taskStoreSchema } from "./sqlite-task-store-schema";

export const withOtherInstallationSessionOwners = (
  store: WorkspaceSessionStorePort,
  configDirectories: readonly string[],
): WorkspaceSessionStorePort => {
  const readOwners: WorkspaceSessionStorePort["listRuntimeOwners"] = (scope) =>
    Effect.forEach(configDirectories, (configDir) =>
      Effect.scoped(
        Effect.gen(function* () {
          const databasePath = yield* resolveSqliteTaskStoreDatabasePath({
            configDir,
            workspaceId: scope.workspaceId,
          });
          const exists = yield* Effect.tryPromise({
            try: async () => {
              try {
                await stat(databasePath);
                return true;
              } catch (cause) {
                if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
                  return false;
                throw cause;
              }
            },
            catch: (cause) =>
              new HostValidationError({
                message: `Cannot read OpenDucktor session ownership from ${databasePath}. Check access to this task store.`,
                cause,
              }),
          });
          if (!exists) return [];
          return yield* Effect.gen(function* () {
            const connection = yield* openSqliteDrizzleConnection({
              databasePath,
              readOnly: true,
              configureWal: false,
              config: { schema: taskStoreSchema },
            });
            return yield* listRuntimeSessionOwners(connection.session);
          }).pipe(
            Effect.mapError(
              (cause) =>
                new HostValidationError({
                  message: `Cannot read OpenDucktor session ownership from ${databasePath}. Open its installation to check the task store.`,
                  cause,
                }),
            ),
          );
        }),
      ),
    ).pipe(Effect.map((owners) => owners.flat()));

  return {
    ...store,
    listRuntimeOwners: (scope) =>
      Effect.gen(function* () {
        const local = yield* store.listRuntimeOwners(scope);
        return [...local, ...(yield* readOwners(scope))];
      }),
    importSession: (input) =>
      Effect.gen(function* () {
        const owners = yield* readOwners(input);
        if (
          owners.some(
            (owner) =>
              owner.runtimeKind === input.session.runtimeKind &&
              owner.externalSessionId === input.session.externalSessionId,
          )
        ) {
          return yield* new HostValidationError({
            message:
              "This conversation already belongs to another OpenDucktor installation. Open it there.",
          });
        }
        return yield* store.importSession(input);
      }),
  };
};
