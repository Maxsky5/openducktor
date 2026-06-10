import { Effect } from "effect";
import { type HostOperationError, toHostOperationError } from "../../effect/host-errors";

export type SqliteValue = bigint | number | string | null | Uint8Array;

export type SqliteRunResult = {
  changes: number;
  lastInsertRowid: bigint | number;
};

export type SqliteStatement = {
  all(...params: SqliteValue[]): unknown[];
  get(...params: SqliteValue[]): unknown;
  run(...params: SqliteValue[]): SqliteRunResult;
};

export type SqliteDatabase = {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
};

const isBunRuntime = (): boolean => "Bun" in globalThis;

type SqliteDriverModule = {
  Database?: new (path: string, options?: { create?: boolean }) => SqliteDatabase;
  DatabaseSync?: new (path: string) => SqliteDatabase;
};

const importSqliteDriverModule = async (specifier: string): Promise<SqliteDriverModule> => {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<SqliteDriverModule>;
  return dynamicImport(specifier);
};

export const openSqliteDatabase = (
  databasePath: string,
): Effect.Effect<SqliteDatabase, HostOperationError> =>
  Effect.tryPromise({
    try: async () => {
      if (isBunRuntime()) {
        const sqlite = await importSqliteDriverModule("bun:sqlite");
        if (!sqlite.Database) {
          throw new Error("bun:sqlite did not expose Database.");
        }
        return new sqlite.Database(databasePath, { create: true }) as SqliteDatabase;
      }

      const sqlite = await importSqliteDriverModule("node:sqlite");
      if (!sqlite.DatabaseSync) {
        throw new Error("node:sqlite did not expose DatabaseSync.");
      }
      return new sqlite.DatabaseSync(databasePath) as SqliteDatabase;
    },
    catch: (cause) =>
      toHostOperationError(cause, "sqlite.open", {
        path: databasePath,
      }),
  });
