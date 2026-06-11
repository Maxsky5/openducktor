import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Deferred, Effect, Exit } from "effect";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import { mapSqliteTaskStoreAdapterError } from "./sqlite-task-store-errors";
import { ensureSchema } from "./sqlite-task-store-migrations";
import { type TaskStoreSession, taskStoreSchema } from "./sqlite-task-store-schema";

export type ResolveWorkspaceIdForRepoPath = (
  repoPath: string,
) => Effect.Effect<string, TaskStoreError>;

export type ResolveSqliteTaskStorePath = (input: {
  repoPath: string;
  workspaceId: string;
}) => Effect.Effect<string, TaskStoreError>;

export type SqliteTaskRepositoryContext = {
  databasePath: string;
  repoPath: string;
  session: TaskStoreSession;
  workspaceId: string;
};

export type SqliteTaskRepositoryContextProvider = <A>(
  repoPath: string,
  operation: string,
  use: (context: SqliteTaskRepositoryContext) => Effect.Effect<A, unknown>,
) => Effect.Effect<A, TaskStoreError>;

type CreateSqliteTaskRepositoryContextProviderInput = {
  processEnv: NodeJS.ProcessEnv;
  resolveDatabasePath?: ResolveSqliteTaskStorePath;
  resolveWorkspaceIdForRepoPath: ResolveWorkspaceIdForRepoPath;
};

type SqliteTaskRepositoryStorage = {
  databasePath: string;
  repoPath: string;
  workspaceId: string;
};

type SchemaInitializationFlight = Deferred.Deferred<void, TaskStoreError>;

const resolveDefaultDatabasePath =
  (processEnv: NodeJS.ProcessEnv): ResolveSqliteTaskStorePath =>
  ({ workspaceId }) =>
    resolveSqliteTaskStoreDatabasePath({
      configDir: resolveOpenDucktorBaseDir(processEnv),
      workspaceId,
    });

export const createSqliteTaskRepositoryContextProvider = ({
  processEnv,
  resolveDatabasePath = resolveDefaultDatabasePath(processEnv),
  resolveWorkspaceIdForRepoPath,
}: CreateSqliteTaskRepositoryContextProviderInput): SqliteTaskRepositoryContextProvider => {
  const initializedDatabasePaths = new Set<string>();
  const schemaInitializationFlights = new Map<string, SchemaInitializationFlight>();

  const completeSchemaInitializationFlight = (
    databasePath: string,
    flight: SchemaInitializationFlight,
    initialize: Effect.Effect<void, TaskStoreError>,
  ) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(initialize);
      if (Exit.isSuccess(exit)) {
        initializedDatabasePaths.add(databasePath);
      }
      yield* Deferred.done(flight, exit);
      if (Exit.isFailure(exit)) {
        return yield* Effect.failCause(exit.cause);
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (schemaInitializationFlights.get(databasePath) === flight) {
            schemaInitializationFlights.delete(databasePath);
          }
        }),
      ),
    );

  const resolveStorage = (repoPath: string) =>
    Effect.gen(function* () {
      const workspaceId = yield* resolveWorkspaceIdForRepoPath(repoPath);
      const databasePath = yield* resolveDatabasePath({ repoPath, workspaceId });
      yield* Effect.tryPromise({
        try: () => mkdir(path.dirname(databasePath), { recursive: true }),
        catch: (cause) =>
          new HostOperationError({
            operation: "sqliteTaskRepository.createDatabaseDirectory",
            message: errorMessage(cause),
            cause,
            details: { databasePath },
          }),
      });
      return {
        databasePath,
        repoPath,
        workspaceId,
      } satisfies SqliteTaskRepositoryStorage;
    });

  const initializeWorkspaceTaskStore = (databasePath: string) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const newFlight = yield* Deferred.make<void, TaskStoreError>();
        const reservation = yield* Effect.sync(() => {
          if (initializedDatabasePaths.has(databasePath)) {
            return { _tag: "initialized" as const };
          }
          const existingFlight = schemaInitializationFlights.get(databasePath);
          if (existingFlight) {
            return { _tag: "existing" as const, flight: existingFlight };
          }
          schemaInitializationFlights.set(databasePath, newFlight);
          return { _tag: "created" as const, flight: newFlight };
        });

        if (reservation._tag === "initialized") {
          return;
        }

        if (reservation._tag === "existing") {
          return yield* restore(Deferred.await(reservation.flight));
        }

        const initialize = Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* openSqliteDrizzleConnection<typeof taskStoreSchema>({
              databasePath,
              config: {
                schema: taskStoreSchema,
              },
            });
            yield* ensureSchema(connection.database, connection.session, databasePath);
          }),
        );
        return yield* completeSchemaInitializationFlight(
          databasePath,
          reservation.flight,
          initialize,
        );
      }),
    );

  const openInitializedWorkspaceTaskStoreSession = (storage: SqliteTaskRepositoryStorage) =>
    Effect.gen(function* () {
      yield* initializeWorkspaceTaskStore(storage.databasePath);
      const connection = yield* openSqliteDrizzleConnection<typeof taskStoreSchema>({
        databasePath: storage.databasePath,
        config: {
          schema: taskStoreSchema,
        },
      });
      return connection.session;
    });

  return (repoPath, operation, use) =>
    Effect.gen(function* () {
      const storage = yield* resolveStorage(repoPath);
      const program = Effect.gen(function* () {
        const session = yield* openInitializedWorkspaceTaskStoreSession(storage);
        return yield* use({
          ...storage,
          session,
        });
      });
      return yield* Effect.scoped(program).pipe(
        Effect.mapError((cause) =>
          mapSqliteTaskStoreAdapterError(operation, storage.databasePath, cause),
        ),
      );
    });
};
