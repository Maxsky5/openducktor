import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";

export type SqliteValue = bigint | number | string | null | Uint8Array;
export type SqliteRow = Record<string, SqliteValue>;
export type SqliteValueRow = SqliteValue[];

export type SqliteRunResult = {
  changes: bigint | number;
  lastInsertRowid: bigint | number;
};

export type SqliteDriverRuntime = "bun" | "node";

export type SqliteStatement = {
  all(...params: SqliteValue[]): Effect.Effect<SqliteRow[], HostOperationError>;
  close(): Effect.Effect<void, HostOperationError>;
  get(...params: SqliteValue[]): Effect.Effect<SqliteRow | null, HostOperationError>;
  run(...params: SqliteValue[]): Effect.Effect<SqliteRunResult, HostOperationError>;
  values(...params: SqliteValue[]): Effect.Effect<SqliteValueRow[], HostOperationError>;
};

export type SqliteDatabase = {
  close(): Effect.Effect<void, HostOperationError>;
  exec(sql: string): Effect.Effect<void, HostOperationError>;
  prepare(sql: string): Effect.Effect<SqliteStatement, HostOperationError>;
};

type BunSqliteStatement = {
  all(...params: SqliteValue[]): SqliteRow[];
  finalize(): void;
  get(...params: SqliteValue[]): SqliteRow | null;
  run(...params: SqliteValue[]): SqliteRunResult;
  values(...params: SqliteValue[]): SqliteValueRow[];
};

type BunSqliteDatabase = {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): BunSqliteStatement;
};

type BunSqliteModule = {
  Database: new (path: string, options: { create: true }) => BunSqliteDatabase;
};

type NodeSqliteStatement = {
  all(...params: SqliteValue[]): SqliteRow[];
  get(...params: SqliteValue[]): SqliteRow | undefined;
  run(...params: SqliteValue[]): SqliteRunResult;
  setReturnArrays(enabled: boolean): void;
};

type NodeSqliteDatabase = {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
};

type NodeSqliteModule = {
  DatabaseSync: new (path: string) => NodeSqliteDatabase;
};

const bunSqliteModuleSpecifier = "bun:sqlite";
const nodeSqliteModuleSpecifier = "node:sqlite";

export const currentSqliteDriverRuntime = (): SqliteDriverRuntime =>
  "Bun" in globalThis ? "bun" : "node";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const isBunSqliteModule = (value: unknown): value is BunSqliteModule =>
  isRecord(value) && typeof value.Database === "function";

const isNodeSqliteModule = (value: unknown): value is NodeSqliteModule =>
  isRecord(value) && typeof value.DatabaseSync === "function";

const importRuntimeModule = (specifier: string): Promise<unknown> => import(specifier);

const isSqliteValue = (value: unknown): value is SqliteValue =>
  value === null ||
  typeof value === "bigint" ||
  typeof value === "number" ||
  typeof value === "string" ||
  value instanceof Uint8Array;

const unsupportedSqliteDriverShape = (
  operation: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
): HostOperationError =>
  new HostOperationError({
    operation,
    message,
    details,
  });

const rowValues = (row: SqliteRow): Effect.Effect<SqliteValueRow, HostOperationError> => {
  const values: unknown[] = Object.values(row);
  if (values.every(isSqliteValue)) {
    return Effect.succeed(values);
  }

  return Effect.fail(
    unsupportedSqliteDriverShape(
      "sqlite.readValues",
      "node:sqlite returned a row value that is not supported by OpenDucktor.",
      {
        valueTypes: values.map((value) =>
          value === null ? "null" : value instanceof Uint8Array ? "Uint8Array" : typeof value,
        ),
      },
    ),
  );
};

const importSqliteModule = (specifier: string): Effect.Effect<unknown, HostOperationError> =>
  Effect.tryPromise({
    try: () => importRuntimeModule(specifier),
    catch: (cause) =>
      toHostOperationError(cause, "sqlite.importRuntimeModule", {
        specifier,
      }),
  });

const loadBunSqliteModule = (): Effect.Effect<BunSqliteModule, HostOperationError> =>
  Effect.gen(function* () {
    const sqlite = yield* importSqliteModule(bunSqliteModuleSpecifier);
    if (!isBunSqliteModule(sqlite)) {
      return yield* Effect.fail(
        unsupportedSqliteDriverShape(
          "sqlite.loadBunModule",
          "bun:sqlite did not expose Database.",
          { specifier: bunSqliteModuleSpecifier },
        ),
      );
    }
    return sqlite;
  });

const loadNodeSqliteModule = (): Effect.Effect<NodeSqliteModule, HostOperationError> =>
  Effect.gen(function* () {
    const sqlite = yield* importSqliteModule(nodeSqliteModuleSpecifier);
    if (!isNodeSqliteModule(sqlite)) {
      return yield* Effect.fail(
        unsupportedSqliteDriverShape(
          "sqlite.loadNodeModule",
          "node:sqlite did not expose DatabaseSync.",
          { specifier: nodeSqliteModuleSpecifier },
        ),
      );
    }
    return sqlite;
  });

const runSqliteOperation = <A>(
  operation: string,
  run: () => A,
): Effect.Effect<A, HostOperationError> =>
  Effect.try({
    try: run,
    catch: (cause) => toHostOperationError(cause, operation),
  });

const adaptBunStatement = (statement: BunSqliteStatement): SqliteStatement => ({
  all: (...params) => runSqliteOperation("sqlite.bunStatement.all", () => statement.all(...params)),
  close: () => runSqliteOperation("sqlite.bunStatement.finalize", () => statement.finalize()),
  get: (...params) => runSqliteOperation("sqlite.bunStatement.get", () => statement.get(...params)),
  run: (...params) => runSqliteOperation("sqlite.bunStatement.run", () => statement.run(...params)),
  values: (...params) =>
    runSqliteOperation("sqlite.bunStatement.values", () => statement.values(...params)),
});

const adaptNodeStatement = (statement: NodeSqliteStatement): SqliteStatement => ({
  all: (...params) =>
    runSqliteOperation("sqlite.nodeStatement.all", () => statement.all(...params)),
  close: () => Effect.void,
  get: (...params) =>
    runSqliteOperation("sqlite.nodeStatement.get", () => statement.get(...params) ?? null),
  run: (...params) =>
    runSqliteOperation("sqlite.nodeStatement.run", () => statement.run(...params)),
  values: (...params) =>
    Effect.gen(function* () {
      yield* runSqliteOperation("sqlite.nodeStatement.enableReturnArrays", () =>
        statement.setReturnArrays(true),
      );
      const rows = yield* runSqliteOperation("sqlite.nodeStatement.values", () =>
        statement.all(...params),
      );
      return yield* Effect.all(rows.map((row) => rowValues(row)));
    }).pipe(
      Effect.ensuring(
        runSqliteOperation("sqlite.nodeStatement.disableReturnArrays", () =>
          statement.setReturnArrays(false),
        ).pipe(Effect.ignore),
      ),
    ),
});

const adaptBunDatabase = (database: BunSqliteDatabase): SqliteDatabase => ({
  close: () => runSqliteOperation("sqlite.bunDatabase.close", () => database.close()),
  exec: (sql) => runSqliteOperation("sqlite.bunDatabase.exec", () => database.exec(sql)),
  prepare: (sql) =>
    runSqliteOperation("sqlite.bunDatabase.prepare", () =>
      adaptBunStatement(database.prepare(sql)),
    ),
});

const adaptNodeDatabase = (database: NodeSqliteDatabase): SqliteDatabase => ({
  close: () => runSqliteOperation("sqlite.nodeDatabase.close", () => database.close()),
  exec: (sql) => runSqliteOperation("sqlite.nodeDatabase.exec", () => database.exec(sql)),
  prepare: (sql) =>
    runSqliteOperation("sqlite.nodeDatabase.prepare", () =>
      adaptNodeStatement(database.prepare(sql)),
    ),
});

const openBunSqliteDatabase = (
  databasePath: string,
): Effect.Effect<SqliteDatabase, HostOperationError> =>
  Effect.gen(function* () {
    const { Database } = yield* loadBunSqliteModule();
    const database = yield* runSqliteOperation(
      "sqlite.openBunDatabase",
      () => new Database(databasePath, { create: true }),
    );
    return adaptBunDatabase(database);
  });

const openNodeSqliteDatabase = (
  databasePath: string,
): Effect.Effect<SqliteDatabase, HostOperationError> =>
  Effect.gen(function* () {
    const { DatabaseSync } = yield* loadNodeSqliteModule();
    const database = yield* runSqliteOperation(
      "sqlite.openNodeDatabase",
      () => new DatabaseSync(databasePath),
    );
    return adaptNodeDatabase(database);
  });

export const openSqliteDatabase = (
  databasePath: string,
  runtime: SqliteDriverRuntime = currentSqliteDriverRuntime(),
): Effect.Effect<SqliteDatabase, HostOperationError> =>
  runtime === "bun" ? openBunSqliteDatabase(databasePath) : openNodeSqliteDatabase(databasePath);
