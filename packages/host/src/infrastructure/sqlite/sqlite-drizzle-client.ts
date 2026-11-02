import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import {
  type AsyncRemoteCallback,
  drizzle,
  type SqliteRemoteDatabase,
} from "drizzle-orm/sqlite-proxy";
import type { DrizzleConfig } from "drizzle-orm/utils";
import { Context, Deferred, Effect, Exit, Scope } from "effect";
import type { ZodError } from "zod";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  currentSqliteDriverRuntime,
  openSqliteDatabase,
  type SqliteDatabase,
  type SqliteDriverRuntime,
  type SqliteValue,
  type SqliteValueRow,
} from "./sqlite-driver";
import { sqliteValueSchema } from "./sqlite-driver-values";

type SqliteRemoteMethod = Parameters<AsyncRemoteCallback>[2];
type SqliteRemoteRows = { rows: SqliteValueRow | SqliteValueRow[] };
export type SqliteDrizzleExecutor<TSchema extends Record<string, AnySQLiteTable>> =
  SqliteRemoteDatabase<TSchema>;

/** `TransactionError` is an extra failure that a wrapped session can add when a transaction starts. */
export type SqliteDrizzleSession<
  TSchema extends Record<string, AnySQLiteTable>,
  TransactionError = never,
> = {
  readonly database: SqliteDrizzleExecutor<TSchema>;
  readonly transactionKind: "read" | "write" | null;
  readonly afterCommit: (
    effect: Effect.Effect<void>,
  ) => Effect.Effect<void, HostOperationErrorAggregate>;
  readonly readTransaction: <A, E>(
    operation: string,
    use: (session: SqliteDrizzleSession<TSchema, TransactionError>) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | HostOperationErrorAggregate | TransactionError>;
  readonly execute: <A, Details extends object>(
    run: (database: SqliteDrizzleExecutor<TSchema>) => PromiseLike<A>,
    operation: string,
    details?: Readonly<Details>,
  ) => Effect.Effect<A, HostOperationErrorAggregate>;
  readonly transaction: <A, E>(
    operation: string,
    use: (session: SqliteDrizzleSession<TSchema, TransactionError>) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | HostOperationErrorAggregate | TransactionError>;
};

export type SqliteDrizzleConnection<TSchema extends Record<string, AnySQLiteTable>> = {
  readonly close: Effect.Effect<void, HostOperationErrorAggregate>;
  readonly database: SqliteRemoteDatabase<TSchema>;
  readonly session: SqliteDrizzleSession<TSchema>;
};

export type OpenSqliteDrizzleConnectionInput<TSchema extends Record<string, AnySQLiteTable>> = {
  readonly config: DrizzleConfig<TSchema>;
  readonly configureWal: boolean;
  readonly configureHostDatabase?: boolean;
  readonly databasePath: string;
  readonly runtime?: SqliteDriverRuntime;
};

export const openSqliteDrizzleConnection = <TSchema extends Record<string, AnySQLiteTable>>({
  config,
  configureWal,
  configureHostDatabase = false,
  databasePath,
  runtime = currentSqliteDriverRuntime(),
}: OpenSqliteDrizzleConnectionInput<TSchema>): Effect.Effect<
  SqliteDrizzleConnection<TSchema>,
  HostOperationErrorAggregate,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const sqlite = yield* openSqliteDatabase(databasePath, runtime);
    const closeCompletion = yield* Deferred.make<void, HostOperationErrorAggregate>();
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
        Effect.catch((cause) =>
          Effect.logWarning(`Failed to close the SQLite database: ${cause.message}`),
        ),
      ),
    );
    yield* configureDatabase(sqlite, configureWal, configureHostDatabase);

    let activeSignal: AbortSignal | undefined;
    const database = drizzle(
      makeRemoteCallback(sqlite, () => activeSignal),
      config,
    );
    const execute: SqliteDrizzleSession<TSchema>["execute"] = (run, operation, details) =>
      Effect.tryPromise({
        try: (signal) => {
          const previous = activeSignal;
          activeSignal = signal;
          return Promise.resolve(run(database)).finally(() => {
            activeSignal = previous;
          });
        },
        catch: (cause) =>
          details === undefined
            ? toHostOperationError(cause, operation)
            : toHostOperationError(cause, operation, details),
      });
    return {
      close,
      database,
      session: makeSession(database, execute, sqlite),
    };
  });

const unsupportedParameterValue = (cause: ZodError): HostOperationError =>
  new HostOperationError({
    operation: "sqlite.drizzleParameter",
    message: "Unsupported SQLite parameter value.",
    cause,
  });

const executeRemoteQuery = (
  database: SqliteDatabase,
  query: string,
  params: readonly SqliteValue[],
  method: SqliteRemoteMethod,
): Effect.Effect<SqliteRemoteRows, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const statement = yield* database.prepare(query);
    return yield* Effect.gen(function* () {
      if (method === "run") {
        yield* statement.run(...params);
        return { rows: [] };
      }

      if (method === "get") {
        const rows = yield* statement.values(...params);
        return { rows: rows[0] ?? [] };
      }

      return { rows: yield* statement.values(...params) };
    }).pipe(Effect.ensuring(statement.close().pipe(Effect.ignore)));
  });

const makeRemoteCallback =
  (database: SqliteDatabase, currentSignal: () => AbortSignal | undefined): AsyncRemoteCallback =>
  (query, params, method) => {
    const sqliteParams = Effect.all(
      params.map((param) => {
        const parsed = sqliteValueSchema.safeParse(param);
        return parsed.success
          ? Effect.succeed(parsed.data)
          : Effect.fail(unsupportedParameterValue(parsed.error));
      }),
    );
    return Effect.runPromise(
      sqliteParams.pipe(
        Effect.flatMap((values) => executeRemoteQuery(database, query, values, method)),
      ),
      { signal: currentSignal() },
    );
  };

const configureDatabase = (
  database: SqliteDatabase,
  configureWal: boolean,
  configureHostDatabase: boolean,
): Effect.Effect<void, HostOperationErrorAggregate> =>
  database.exec("PRAGMA busy_timeout = 0; PRAGMA foreign_keys = ON;").pipe(
    Effect.andThen(
      configureHostDatabase
        ? configureHostJournal(database)
        : configureWal
          ? database.exec("PRAGMA journal_mode = WAL;")
          : Effect.void,
    ),
    Effect.mapError((cause) => toHostOperationError(cause, "sqlite.configureDatabase")),
  );

/** SQLite reports a refused journal change only through the returned mode. */
const configureHostJournal = (
  database: SqliteDatabase,
): Effect.Effect<void, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const statement = yield* database.prepare("PRAGMA journal_mode = DELETE");
    const rows = yield* statement
      .values()
      .pipe(Effect.ensuring(statement.close().pipe(Effect.ignore)));
    const mode = rows[0]?.[0];
    if (mode !== "delete")
      return yield* new HostOperationError({
        operation: "sqlite.configureDatabase",
        message: `The host database stayed in journal mode ${String(mode)}. Stop every OpenDucktor host that uses this config root, then start one host again.`,
      });
    yield* database.exec("PRAGMA synchronous = EXTRA;");
  });

const makeSession = <TSchema extends Record<string, AnySQLiteTable>>(
  database: SqliteDrizzleExecutor<TSchema>,
  execute: SqliteDrizzleSession<TSchema>["execute"],
  native: SqliteDatabase,
  transactionKind: "read" | "write" | null = null,
  currentTransaction = Context.Reference<SqliteDrizzleSession<TSchema> | null>(
    `sqlite-transaction:${crypto.randomUUID()}`,
    { defaultValue: () => null },
  ),
  committedEffects: Effect.Effect<void>[] = [],
): SqliteDrizzleSession<TSchema> => {
  const runTransaction = <A, E>(
    operation: string,
    kind: "read" | "write",
    use: (session: SqliteDrizzleSession<TSchema>) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | HostOperationErrorAggregate> => {
    const run = (): Effect.Effect<A, E | HostOperationErrorAggregate> => {
      if (transactionKind !== null) {
        if (transactionKind === "read" && kind === "write") {
          return Effect.fail(
            new HostOperationError({
              operation,
              message:
                "A database write cannot run inside a read snapshot. Start a separate write transaction.",
            }),
          );
        }
        return use(session);
      }
      // Native Effects keep lock waits cancelable and run rollback in this resource scope.
      return Effect.suspend(() => {
        let committed = false;
        const afterCommit: Effect.Effect<void>[] = [];
        const transaction = makeSession(
          database,
          execute,
          native,
          kind,
          currentTransaction,
          afterCommit,
        );
        return Effect.uninterruptibleMask((restore) =>
          restore(native.exec(kind === "write" ? "BEGIN IMMEDIATE" : "BEGIN")).pipe(
            Effect.andThen(
              restore(
                use(transaction).pipe(Effect.provideService(currentTransaction, transaction)),
              ),
            ),
            Effect.flatMap((value) =>
              native.exec("COMMIT").pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    committed = true;
                  }),
                ),
                Effect.andThen(Effect.forEach(afterCommit, (effect) => effect, { discard: true })),
                Effect.as(value),
              ),
            ),
            Effect.onExit(() =>
              committed
                ? Effect.void
                : native
                    .inTransaction()
                    .pipe(
                      Effect.flatMap((active) => (active ? native.exec("ROLLBACK") : Effect.void)),
                    ),
            ),
          ),
        );
      });
    };
    return Effect.flatMap(currentTransaction, (current) => {
      if (current === null || current === session) return run();
      return kind === "write"
        ? current.transaction(operation, use)
        : current.readTransaction(operation, use);
    });
  };
  const session: SqliteDrizzleSession<TSchema> = {
    database,
    execute,
    transactionKind,
    afterCommit: (effect) =>
      Effect.flatMap(currentTransaction, (current) => {
        if (current !== null && current !== session) return current.afterCommit(effect);
        return transactionKind === "write"
          ? Effect.gen(function* () {
              const context = yield* Effect.context<never>();
              committedEffects.push(effect.pipe(Effect.provideContext(context)));
            })
          : Effect.fail(
              new HostOperationError({
                operation: "sqlite.afterCommit",
                message: "An after-commit action requires an active write transaction.",
              }),
            );
      }),
    transaction: (operation, use) => runTransaction(operation, "write", use),
    readTransaction: (operation, use) => runTransaction(operation, "read", use),
  };
  return session;
};
