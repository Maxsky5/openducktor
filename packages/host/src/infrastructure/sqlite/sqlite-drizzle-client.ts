import type { ExtractTablesWithRelations } from "drizzle-orm/relations";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import {
  type AsyncRemoteCallback,
  drizzle,
  type SqliteRemoteDatabase,
} from "drizzle-orm/sqlite-proxy";
import type { SQLiteProxyTransaction } from "drizzle-orm/sqlite-proxy/session";
import type { DrizzleConfig } from "drizzle-orm/utils";
import { type Cause, Deferred, Effect, Exit, Scope } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import {
  currentSqliteDriverRuntime,
  openSqliteDatabase,
  type SqliteDatabase,
  type SqliteDriverRuntime,
  type SqliteValue,
} from "./sqlite-driver";
import type { JsonValue } from "@openducktor/contracts";

type SqliteRemoteMethod = Parameters<AsyncRemoteCallback>[2];
type SqliteRemoteRows = { rows: unknown[] };
type SqliteDrizzleTransaction<TSchema extends Record<string, AnySQLiteTable>> =
  SQLiteProxyTransaction<TSchema, ExtractTablesWithRelations<TSchema>>;

export type SqliteDrizzleExecutor<TSchema extends Record<string, AnySQLiteTable>> =
  | SqliteRemoteDatabase<TSchema>
  | SqliteDrizzleTransaction<TSchema>;

export type SqliteDrizzleSession<TSchema extends Record<string, AnySQLiteTable>> = {
  readonly database: SqliteDrizzleExecutor<TSchema>;
  readonly execute: <A>(
    run: (database: SqliteDrizzleExecutor<TSchema>) => PromiseLike<A>,
    operation: string,
    details?: Readonly<Record<string, JsonValue>>,
  ) => Effect.Effect<A, HostOperationError>;
  readonly transaction: <A, E>(
    operation: string,
    use: (session: SqliteDrizzleSession<TSchema>) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | HostOperationError>;
};

export type SqliteDrizzleConnection<TSchema extends Record<string, AnySQLiteTable>> = {
  readonly close: Effect.Effect<void, HostOperationError>;
  readonly database: SqliteRemoteDatabase<TSchema>;
  readonly session: SqliteDrizzleSession<TSchema>;
};

export type OpenSqliteDrizzleConnectionInput<TSchema extends Record<string, AnySQLiteTable>> = {
  readonly config: DrizzleConfig<TSchema>;
  readonly configureWal: boolean;
  readonly databasePath: string;
  readonly runtime?: SqliteDriverRuntime;
};

const unsupportedParameterValue = (value: unknown): HostOperationError =>
  new HostOperationError({
    operation: "sqlite.drizzleParameter",
    message: "Unsupported SQLite parameter value.",
    details: {
      valueType: value instanceof Uint8Array ? "Uint8Array" : typeof value,
    },
  });

const toSqliteValue = (value: unknown): Effect.Effect<SqliteValue, HostOperationError> => {
  if (
    value === null ||
    typeof value === "bigint" ||
    typeof value === "number" ||
    typeof value === "string" ||
    value instanceof Uint8Array
  ) {
    return Effect.succeed(value);
  }

  return Effect.fail(unsupportedParameterValue(value));
};

const toSqliteValues = (
  params: ReadonlyArray<unknown>,
): Effect.Effect<SqliteValue[], HostOperationError> =>
  Effect.all(params.map((param) => toSqliteValue(param)));

const executeRemoteQuery = (
  database: SqliteDatabase,
  query: string,
  params: ReadonlyArray<unknown>,
  method: SqliteRemoteMethod,
): Effect.Effect<SqliteRemoteRows, HostOperationError> =>
  Effect.gen(function* () {
    const statement = yield* database.prepare(query);
    return yield* Effect.gen(function* () {
      const sqliteParams = yield* toSqliteValues(params);

      if (method === "run") {
        yield* statement.run(...sqliteParams);
        return { rows: [] };
      }

      if (method === "get") {
        const rows = yield* statement.values(...sqliteParams);
        return { rows: rows[0] ?? [] };
      }

      return { rows: yield* statement.values(...sqliteParams) };
    }).pipe(Effect.ensuring(statement.close().pipe(Effect.ignore)));
  });

const makeRemoteCallback =
  (database: SqliteDatabase): AsyncRemoteCallback =>
  (query, params, method) =>
    Effect.runPromise(executeRemoteQuery(database, query, params, method));

const configureDatabase = (
  database: SqliteDatabase,
  configureWal: boolean,
): Effect.Effect<void, HostOperationError> => {
  const enableForeignKeys = database.exec("PRAGMA foreign_keys = ON;");
  const configure = configureWal
    ? enableForeignKeys.pipe(Effect.zipRight(database.exec("PRAGMA journal_mode = WAL;")))
    : enableForeignKeys;
  return configure.pipe(
    Effect.mapError((cause) => toHostOperationError(cause, "sqlite.configureDatabase")),
  );
};

const executeSqliteQuery = <A>(
  run: () => PromiseLike<A>,
  operation: string,
  details?: Readonly<Record<string, JsonValue>>,
): Effect.Effect<A, HostOperationError> =>
  Effect.tryPromise({
    try: () => Promise.resolve(run()),
    catch: (cause) => toHostOperationError(cause, operation, details),
  });

const runSqliteTransaction = <TSchema extends Record<string, AnySQLiteTable>, A, E>(
  database: SqliteDrizzleExecutor<TSchema>,
  operation: string,
  use: (session: SqliteDrizzleSession<TSchema>) => Effect.Effect<A, E>,
): Effect.Effect<A, E | HostOperationError> =>
  Effect.gen(function* () {
    class SqliteTransactionRollback extends Error {
      constructor(readonly failureCause: Cause.Cause<E>) {
        super("SQLite transaction rolled back because the Effect transaction failed.");
      }
    }

    return yield* Effect.tryPromise({
      try: () =>
        database.transaction(async (transaction) => {
          const exit = await Effect.runPromiseExit(use(makeSqliteDrizzleSession(transaction)));
          if (Exit.isSuccess(exit)) {
            return exit.value;
          }
          return Promise.reject(new SqliteTransactionRollback(exit.cause));
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.catchAll((cause): Effect.Effect<A, E | HostOperationError> => {
        if (cause instanceof SqliteTransactionRollback) {
          return Effect.failCause(cause.failureCause);
        }
        return Effect.fail(toHostOperationError(cause, operation));
      }),
    );
  });

const makeSqliteDrizzleSession = <TSchema extends Record<string, AnySQLiteTable>>(
  database: SqliteDrizzleExecutor<TSchema>,
): SqliteDrizzleSession<TSchema> => ({
  database,
  execute: (run, operation, details) => executeSqliteQuery(() => run(database), operation, details),
  transaction: (operation, use) => runSqliteTransaction(database, operation, use),
});

export const openSqliteDrizzleConnection = <TSchema extends Record<string, AnySQLiteTable>>({
  config,
  configureWal,
  databasePath,
  runtime = currentSqliteDriverRuntime(),
}: OpenSqliteDrizzleConnectionInput<TSchema>): Effect.Effect<
  SqliteDrizzleConnection<TSchema>,
  HostOperationError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const sqlite = yield* openSqliteDatabase(databasePath, runtime);
    const closeCompletion = yield* Deferred.make<void, HostOperationError>();
    let closeStarted = false;
    const close = Effect.uninterruptible(
      Effect.gen(function* () {
        const ownsClose = yield* Effect.sync(() => {
          if (closeStarted) return false;
          closeStarted = true;
          return true;
        });
        if (!ownsClose) {
          return yield* Deferred.await(closeCompletion);
        }
        const closeExit = yield* Effect.exit(sqlite.close());
        yield* Deferred.done(closeCompletion, closeExit);
        if (Exit.isFailure(closeExit)) {
          return yield* Effect.failCause(closeExit.cause);
        }
      }),
    );
    const scope = yield* Effect.scope;
    yield* Scope.addFinalizer(
      scope,
      close.pipe(
        Effect.catchAll((cause) =>
          Effect.logWarning(`Failed to close SQLite task store database: ${cause.message}`),
        ),
      ),
    );
    yield* configureDatabase(sqlite, configureWal);

    const database = drizzle(makeRemoteCallback(sqlite), config);
    return {
      close,
      database,
      session: makeSqliteDrizzleSession(database),
    };
  });
