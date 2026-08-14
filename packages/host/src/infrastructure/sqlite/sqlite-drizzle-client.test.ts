import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { Effect, Exit, Scope } from "effect";
import { openSqliteDrizzleConnection } from "./sqlite-drizzle-client";

const tempDirectories = new Set<string>();

const createDatabasePath = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "openducktor-sqlite-drizzle-"));
  tempDirectories.add(directory);
  return path.join(directory, "database.sqlite");
};

const readJournalMode = (databasePath: string): string => {
  const database = new Database(databasePath);
  try {
    const result = database.query("PRAGMA journal_mode;").get() as { journal_mode: string };
    return result.journal_mode;
  } finally {
    database.close();
  }
};

afterEach(async () => {
  await Promise.all(
    Array.from(tempDirectories, (directory) => rm(directory, { force: true, recursive: true })),
  );
  tempDirectories.clear();
});

test("configures WAL only when the connection owns persistent setup", async () => {
  const databasePath = await createDatabasePath();

  await Effect.runPromise(
    Effect.scoped(
      openSqliteDrizzleConnection({
        config: {},
        configureWal: false,
        databasePath,
      }),
    ),
  );
  expect(readJournalMode(databasePath)).toBe("delete");

  await Effect.runPromise(
    Effect.scoped(
      openSqliteDrizzleConnection({
        config: {},
        configureWal: true,
        databasePath,
      }),
    ),
  );
  expect(readJournalMode(databasePath)).toBe("wal");
});

test("closes a retained connection exactly once", async () => {
  const databasePath = await createDatabasePath();

  const queryAfterClose = await Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const connection = yield* openSqliteDrizzleConnection({
        config: {},
        configureWal: true,
        databasePath,
      }).pipe(Scope.extend(scope));
      yield* Effect.all([connection.close, connection.close], { discard: true });
      yield* Scope.close(scope, Exit.void);
      return yield* Effect.either(
        connection.session.execute(
          (database) => database.run(sql.raw("SELECT 1;")),
          "test.query-after-close",
        ),
      );
    }),
  );

  expect(queryAfterClose._tag).toBe("Left");
});
