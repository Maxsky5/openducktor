import { Effect } from "effect";
import { type HostOperationError, toHostOperationError } from "../../effect/host-errors";

export type SqliteValue = bigint | number | string | null | Uint8Array;
export type SqliteRow = Record<string, SqliteValue>;

export type SqliteRunResult = {
  changes: bigint | number;
  lastInsertRowid: bigint | number;
};

export type SqliteStatement = {
  all(...params: SqliteValue[]): SqliteRow[];
  get(...params: SqliteValue[]): SqliteRow | null;
  run(...params: SqliteValue[]): SqliteRunResult;
};

export type SqliteDatabase = {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
};

type BunSqliteStatement = {
  all(...params: SqliteValue[]): SqliteRow[];
  get(...params: SqliteValue[]): SqliteRow | null;
  run(...params: SqliteValue[]): SqliteRunResult;
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

const isBunRuntime = (): boolean => "Bun" in globalThis;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const isBunSqliteModule = (value: unknown): value is BunSqliteModule =>
  isRecord(value) && typeof value.Database === "function";

const isNodeSqliteModule = (value: unknown): value is NodeSqliteModule =>
  isRecord(value) && typeof value.DatabaseSync === "function";

const importRuntimeModule = (specifier: string): Promise<unknown> => import(specifier);

const loadBunSqliteModule = async (): Promise<BunSqliteModule> => {
  const sqlite = await importRuntimeModule(bunSqliteModuleSpecifier);
  if (!isBunSqliteModule(sqlite)) {
    throw new Error("bun:sqlite did not expose Database.");
  }
  return sqlite;
};

const loadNodeSqliteModule = async (): Promise<NodeSqliteModule> => {
  const sqlite = await importRuntimeModule(nodeSqliteModuleSpecifier);
  if (!isNodeSqliteModule(sqlite)) {
    throw new Error("node:sqlite did not expose DatabaseSync.");
  }
  return sqlite;
};

const adaptBunStatement = (statement: BunSqliteStatement): SqliteStatement => ({
  all: (...params) => statement.all(...params),
  get: (...params) => statement.get(...params),
  run: (...params) => statement.run(...params),
});

const adaptNodeStatement = (statement: NodeSqliteStatement): SqliteStatement => ({
  all: (...params) => statement.all(...params),
  get: (...params) => statement.get(...params) ?? null,
  run: (...params) => statement.run(...params),
});

const adaptBunDatabase = (database: BunSqliteDatabase): SqliteDatabase => ({
  close: () => database.close(),
  exec: (sql) => {
    database.exec(sql);
  },
  prepare: (sql) => adaptBunStatement(database.prepare(sql)),
});

const adaptNodeDatabase = (database: NodeSqliteDatabase): SqliteDatabase => ({
  close: () => database.close(),
  exec: (sql) => database.exec(sql),
  prepare: (sql) => adaptNodeStatement(database.prepare(sql)),
});

const openBunSqliteDatabase = async (databasePath: string): Promise<SqliteDatabase> => {
  const { Database } = await loadBunSqliteModule();
  return adaptBunDatabase(new Database(databasePath, { create: true }));
};

const openNodeSqliteDatabase = async (databasePath: string): Promise<SqliteDatabase> => {
  const { DatabaseSync } = await loadNodeSqliteModule();
  return adaptNodeDatabase(new DatabaseSync(databasePath));
};

export const openSqliteDatabase = (
  databasePath: string,
): Effect.Effect<SqliteDatabase, HostOperationError> =>
  Effect.tryPromise({
    try: async () => {
      if (isBunRuntime()) {
        return openBunSqliteDatabase(databasePath);
      }
      return openNodeSqliteDatabase(databasePath);
    },
    catch: (cause) =>
      toHostOperationError(cause, "sqlite.open", {
        path: databasePath,
      }),
  });
