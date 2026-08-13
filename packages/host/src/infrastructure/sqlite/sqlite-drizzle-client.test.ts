import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
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
        databasePath,
      }),
    ),
  );
  expect(readJournalMode(databasePath)).toBe("wal");
});
