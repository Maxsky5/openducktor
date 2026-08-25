import { Effect } from "effect";
import {
  type HostErrorDetails,
  HostOperationError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  isSqliteRow,
  isSqliteRunResult,
  isSqliteValue,
  type SqliteRow,
  type SqliteRunResult,
  type SqliteValue,
  type SqliteValueRow,
} from "./sqlite-driver-values";

export type {
  SqliteRow,
  SqliteRunResult,
  SqliteValue,
  SqliteValueRow,
} from "./sqlite-driver-values";

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
  all(...params: SqliteValue[]): UnvalidatedSqliteRow[];
  finalize(): void;
  get(...params: SqliteValue[]): UnvalidatedSqliteRow | null;
  run(...params: SqliteValue[]): UnvalidatedSqliteRunResult;
  values(...params: SqliteValue[]): UnvalidatedSqliteValueRow[];
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
  all(...params: SqliteValue[]): Array<UnvalidatedSqliteRow | UnvalidatedSqliteValueRow>;
  get(...params: SqliteValue[]): UnvalidatedSqliteRow | undefined;
  run(...params: SqliteValue[]): UnvalidatedSqliteRunResult;
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

type UnvalidatedSqliteRow = Record<string, unknown>;
type UnvalidatedSqliteRunResult = {
  changes: unknown;
  lastInsertRowid: unknown;
};
type UnvalidatedSqliteValueRow = readonly unknown[];

const bunSqliteModuleSpecifier = "bun:sqlite";
const nodeSqliteModuleSpecifier = "node:sqlite";

export const currentSqliteDriverRuntime = (): SqliteDriverRuntime =>
  "Bun" in globalThis ? "bun" : "node";

const isBunSqliteModule = (value: unknown): value is BunSqliteModule =>
  typeof value === "object" &&
  value !== null &&
  "Database" in value &&
  typeof value.Database === "function";

const isNodeSqliteModule = (value: unknown): value is NodeSqliteModule =>
  typeof value === "object" &&
  value !== null &&
  "DatabaseSync" in value &&
  typeof value.DatabaseSync === "function";

const unsupportedSqliteDriver = (
  operation: string,
  message: string,
  details: HostErrorDetails,
): HostOperationError =>
  new HostOperationError({
    operation,
    message,
    details,
  });

const unsupportedSqliteResult = (operation: string, value: unknown): HostOperationError =>
  unsupportedSqliteDriver(operation, "SQLite returned an unsupported result.", {
    valueTag: Object.prototype.toString.call(value),
  });

const parseSqliteRow = (
  operation: string,
  value: unknown,
): Effect.Effect<SqliteRow, HostOperationError> =>
  isSqliteRow(value)
    ? Effect.succeed(value)
    : Effect.fail(unsupportedSqliteResult(operation, value));

const parseOptionalSqliteRow = (
  operation: string,
  value: unknown,
): Effect.Effect<SqliteRow | null, HostOperationError> =>
  value === null || value === undefined ? Effect.succeed(null) : parseSqliteRow(operation, value);

const parseSqliteRows = (
  operation: string,
  value: unknown,
): Effect.Effect<SqliteRow[], HostOperationError> =>
  Array.isArray(value)
    ? Effect.all(value.map((row) => parseSqliteRow(operation, row)))
    : Effect.fail(unsupportedSqliteResult(operation, value));

const parseSqliteValueRow = (
  operation: string,
  value: unknown,
): Effect.Effect<SqliteValueRow, HostOperationError> =>
  Array.isArray(value) && value.every(isSqliteValue)
    ? Effect.succeed(Array.from(value))
    : Effect.fail(unsupportedSqliteResult(operation, value));

const parseSqliteValueRows = (
  operation: string,
  value: unknown,
): Effect.Effect<SqliteValueRow[], HostOperationError> =>
  Array.isArray(value)
    ? Effect.all(value.map((row) => parseSqliteValueRow(operation, row)))
    : Effect.fail(unsupportedSqliteResult(operation, value));

const parseSqliteRunResult = (
  operation: string,
  value: unknown,
): Effect.Effect<SqliteRunResult, HostOperationError> =>
  isSqliteRunResult(value)
    ? Effect.succeed(value)
    : Effect.fail(unsupportedSqliteResult(operation, value));

const importSqliteModule = <Module>(
  specifier: string,
  operation: string,
  invalidMessage: string,
  isModule: (value: unknown) => value is Module,
): Effect.Effect<Module, HostOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const module: unknown = await import(specifier);
      if (!isModule(module)) {
        throw unsupportedSqliteDriver(operation, invalidMessage, { specifier });
      }
      return module;
    },
    catch: (cause) =>
      cause instanceof HostOperationError
        ? cause
        : toHostOperationError(cause, "sqlite.importRuntimeModule", { specifier }),
  });

const loadBunSqliteModule = (): Effect.Effect<BunSqliteModule, HostOperationError> =>
  importSqliteModule(
    bunSqliteModuleSpecifier,
    "sqlite.loadBunModule",
    "bun:sqlite did not expose Database.",
    isBunSqliteModule,
  );

const loadNodeSqliteModule = (): Effect.Effect<NodeSqliteModule, HostOperationError> =>
  importSqliteModule(
    nodeSqliteModuleSpecifier,
    "sqlite.loadNodeModule",
    "node:sqlite did not expose DatabaseSync.",
    isNodeSqliteModule,
  );

const runSqliteOperation = <A>(
  operation: string,
  run: () => A,
): Effect.Effect<A, HostOperationError> =>
  Effect.try({
    try: run,
    catch: (cause) => toHostOperationError(cause, operation),
  });

const adaptBunStatement = (statement: BunSqliteStatement): SqliteStatement => ({
  all: (...params) =>
    runSqliteOperation("sqlite.bunStatement.all", () => statement.all(...params)).pipe(
      Effect.flatMap((value) => parseSqliteRows("sqlite.bunStatement.all", value)),
    ),
  close: () => runSqliteOperation("sqlite.bunStatement.finalize", () => statement.finalize()),
  get: (...params) =>
    runSqliteOperation("sqlite.bunStatement.get", () => statement.get(...params)).pipe(
      Effect.flatMap((value) => parseOptionalSqliteRow("sqlite.bunStatement.get", value)),
    ),
  run: (...params) =>
    runSqliteOperation("sqlite.bunStatement.run", () => statement.run(...params)).pipe(
      Effect.flatMap((value) => parseSqliteRunResult("sqlite.bunStatement.run", value)),
    ),
  values: (...params) =>
    runSqliteOperation("sqlite.bunStatement.values", () => statement.values(...params)).pipe(
      Effect.flatMap((value) => parseSqliteValueRows("sqlite.bunStatement.values", value)),
    ),
});

const adaptNodeStatement = (statement: NodeSqliteStatement): SqliteStatement => ({
  all: (...params) =>
    runSqliteOperation("sqlite.nodeStatement.all", () => statement.all(...params)).pipe(
      Effect.flatMap((value) => parseSqliteRows("sqlite.nodeStatement.all", value)),
    ),
  close: () => Effect.void,
  get: (...params) =>
    runSqliteOperation("sqlite.nodeStatement.get", () => statement.get(...params)).pipe(
      Effect.flatMap((value) => parseOptionalSqliteRow("sqlite.nodeStatement.get", value)),
    ),
  run: (...params) =>
    runSqliteOperation("sqlite.nodeStatement.run", () => statement.run(...params)).pipe(
      Effect.flatMap((value) => parseSqliteRunResult("sqlite.nodeStatement.run", value)),
    ),
  values: (...params) =>
    Effect.gen(function* () {
      yield* runSqliteOperation("sqlite.nodeStatement.enableReturnArrays", () =>
        statement.setReturnArrays(true),
      );
      const value = yield* runSqliteOperation("sqlite.nodeStatement.values", () =>
        statement.all(...params),
      );
      return yield* parseSqliteValueRows("sqlite.nodeStatement.values", value);
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
