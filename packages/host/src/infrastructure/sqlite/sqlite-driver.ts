/// <reference types="bun-types" />

import { Effect } from "effect";
import { z } from "zod";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  sqliteRowSchema,
  sqliteRunResultSchema,
  sqliteValueRowSchema,
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
  all(...params: SqliteValue[]): Effect.Effect<SqliteRow[], HostOperationErrorAggregate>;
  close(): Effect.Effect<void, HostOperationErrorAggregate>;
  get(...params: SqliteValue[]): Effect.Effect<SqliteRow | null, HostOperationErrorAggregate>;
  run(...params: SqliteValue[]): Effect.Effect<SqliteRunResult, HostOperationErrorAggregate>;
  values(...params: SqliteValue[]): Effect.Effect<SqliteValueRow[], HostOperationErrorAggregate>;
};

export type SqliteDatabase = {
  close(): Effect.Effect<void, HostOperationErrorAggregate>;
  exec(sql: string): Effect.Effect<void, HostOperationErrorAggregate>;
  prepare(sql: string): Effect.Effect<SqliteStatement, HostOperationErrorAggregate>;
};

type BunSqliteDatabase = import("bun:sqlite").Database;
type BunSqliteStatement = ReturnType<BunSqliteDatabase["prepare"]>;

type BunSqliteModule = typeof import("bun:sqlite");

type NodeSqliteDatabase = import("node:sqlite").DatabaseSync;
type NodeSqliteStatement = ReturnType<NodeSqliteDatabase["prepare"]>;

type NodeSqliteModule = typeof import("node:sqlite");

const bunSqliteModuleSpecifier = "bun:sqlite";
const nodeSqliteModuleSpecifier = "node:sqlite";
const sqliteRowsSchema = z.array(sqliteRowSchema);
const optionalSqliteRowSchema = sqliteRowSchema.nullish();
const sqliteValueRowsSchema = z.array(sqliteValueRowSchema);

export const currentSqliteDriverRuntime = (): SqliteDriverRuntime =>
  "Bun" in globalThis ? "bun" : "node";

const unsupportedSqliteResult = (operation: string, cause: z.ZodError): HostOperationError =>
  new HostOperationError({
    operation,
    message: "SQLite returned an unsupported result.",
    cause,
  });

const parseOptionalSqliteRow = (
  operation: string,
  result: z.ZodSafeParseResult<SqliteRow | null | undefined>,
): Effect.Effect<SqliteRow | null, HostOperationError> => {
  if (!result.success) return Effect.fail(unsupportedSqliteResult(operation, result.error));
  return Effect.succeed(result.data ?? null);
};

const parseSqliteRows = (
  operation: string,
  result: z.ZodSafeParseResult<SqliteRow[]>,
): Effect.Effect<SqliteRow[], HostOperationError> =>
  result.success
    ? Effect.succeed(result.data)
    : Effect.fail(unsupportedSqliteResult(operation, result.error));

const parseSqliteValueRows = (
  operation: string,
  result: z.ZodSafeParseResult<SqliteValueRow[]>,
): Effect.Effect<SqliteValueRow[], HostOperationError> =>
  result.success
    ? Effect.succeed(result.data)
    : Effect.fail(unsupportedSqliteResult(operation, result.error));

const parseSqliteRunResult = (
  operation: string,
  result: z.ZodSafeParseResult<SqliteRunResult>,
): Effect.Effect<SqliteRunResult, HostOperationError> =>
  result.success
    ? Effect.succeed(result.data)
    : Effect.fail(unsupportedSqliteResult(operation, result.error));

const loadBunSqliteModule = (): Effect.Effect<BunSqliteModule, HostOperationErrorAggregate> =>
  Effect.tryPromise({
    try: () => import("bun:sqlite"),
    catch: (cause) =>
      toHostOperationError(cause, "sqlite.importRuntimeModule", {
        specifier: bunSqliteModuleSpecifier,
      }),
  });

const loadNodeSqliteModule = (): Effect.Effect<NodeSqliteModule, HostOperationErrorAggregate> =>
  Effect.tryPromise({
    try: () => import("node:sqlite"),
    catch: (cause) =>
      toHostOperationError(cause, "sqlite.importRuntimeModule", {
        specifier: nodeSqliteModuleSpecifier,
      }),
  });

const runSqliteOperation = <A>(
  operation: string,
  run: () => A,
): Effect.Effect<A, HostOperationErrorAggregate> =>
  Effect.try({
    try: run,
    catch: (cause) => toHostOperationError(cause, operation),
  });

const adaptBunStatement = (statement: BunSqliteStatement): SqliteStatement => ({
  all: (...params) =>
    runSqliteOperation("sqlite.bunStatement.all", () => statement.all(...params)).pipe(
      Effect.flatMap((value) =>
        parseSqliteRows("sqlite.bunStatement.all", sqliteRowsSchema.safeParse(value)),
      ),
    ),
  close: () => runSqliteOperation("sqlite.bunStatement.finalize", () => statement.finalize()),
  get: (...params) =>
    runSqliteOperation("sqlite.bunStatement.get", () => statement.get(...params)).pipe(
      Effect.flatMap((value) =>
        parseOptionalSqliteRow("sqlite.bunStatement.get", optionalSqliteRowSchema.safeParse(value)),
      ),
    ),
  run: (...params) =>
    runSqliteOperation("sqlite.bunStatement.run", () => statement.run(...params)).pipe(
      Effect.flatMap((value) =>
        parseSqliteRunResult("sqlite.bunStatement.run", sqliteRunResultSchema.safeParse(value)),
      ),
    ),
  values: (...params) =>
    runSqliteOperation("sqlite.bunStatement.values", () => statement.values(...params)).pipe(
      Effect.flatMap((value) =>
        parseSqliteValueRows("sqlite.bunStatement.values", sqliteValueRowsSchema.safeParse(value)),
      ),
    ),
});

const adaptNodeStatement = (statement: NodeSqliteStatement): SqliteStatement => ({
  all: (...params) =>
    runSqliteOperation("sqlite.nodeStatement.all", () => statement.all(...params)).pipe(
      Effect.flatMap((value) =>
        parseSqliteRows("sqlite.nodeStatement.all", sqliteRowsSchema.safeParse(value)),
      ),
    ),
  close: () => Effect.void,
  get: (...params) =>
    runSqliteOperation("sqlite.nodeStatement.get", () => statement.get(...params)).pipe(
      Effect.flatMap((value) =>
        parseOptionalSqliteRow(
          "sqlite.nodeStatement.get",
          optionalSqliteRowSchema.safeParse(value),
        ),
      ),
    ),
  run: (...params) =>
    runSqliteOperation("sqlite.nodeStatement.run", () => statement.run(...params)).pipe(
      Effect.flatMap((value) =>
        parseSqliteRunResult("sqlite.nodeStatement.run", sqliteRunResultSchema.safeParse(value)),
      ),
    ),
  values: (...params) =>
    Effect.gen(function* () {
      yield* runSqliteOperation("sqlite.nodeStatement.enableReturnArrays", () =>
        statement.setReturnArrays(true),
      );
      const value = yield* runSqliteOperation("sqlite.nodeStatement.values", () =>
        statement.all(...params),
      );
      return yield* parseSqliteValueRows(
        "sqlite.nodeStatement.values",
        sqliteValueRowsSchema.safeParse(value),
      );
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
): Effect.Effect<SqliteDatabase, HostOperationErrorAggregate> =>
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
): Effect.Effect<SqliteDatabase, HostOperationErrorAggregate> =>
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
): Effect.Effect<SqliteDatabase, HostOperationErrorAggregate> =>
  runtime === "bun" ? openBunSqliteDatabase(databasePath) : openNodeSqliteDatabase(databasePath);
