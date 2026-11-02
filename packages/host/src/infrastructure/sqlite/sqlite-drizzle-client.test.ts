import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { Context, Deferred, Effect, Exit, Fiber, Scope } from "effect";
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
    const result = database.query<{ journal_mode: string }, []>("PRAGMA journal_mode;").get();
    if (!result) {
      throw new Error("Expected SQLite to return its journal mode.");
    }
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
      }).pipe(Scope.provide(scope));
      yield* Effect.all([connection.close, connection.close], { discard: true });
      yield* Scope.close(scope, Exit.void);
      return yield* Effect.result(
        connection.session.execute(
          (database) => database.run(sql.raw("SELECT 1;")),
          "test.query-after-close",
        ),
      );
    }),
  );

  expect(queryAfterClose._tag).toBe("Failure");
});

test("nested writes share one transaction and roll back the whole change", async () => {
  const databasePath = await createDatabasePath();
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* openSqliteDrizzleConnection({
          config: {},
          configureWal: false,
          configureHostDatabase: true,
          databasePath,
        });
        const session = connection.session;
        yield* session.execute(
          (db) => db.run(sql`CREATE TABLE counter (value INTEGER NOT NULL)`),
          "test.setup",
        );
        const write = yield* Effect.result(
          session.transaction("test.outer", (outer) =>
            Effect.gen(function* () {
              yield* outer.execute(
                (db) => db.run(sql`INSERT INTO counter VALUES (1)`),
                "test.insert",
              );
              yield* session.transaction("test.inner", (inner) =>
                inner.execute((db) => db.run(sql`UPDATE counter SET value = 2`), "test.update"),
              );
              return yield* Effect.fail("reject change");
            }),
          ),
        );
        const rows = yield* session.execute(
          (db) => db.values<[number]>(sql`SELECT value FROM counter`),
          "test.read",
        );
        return { write, rows };
      }),
    ),
  );
  expect(result.write._tag).toBe("Failure");
  if (result.write._tag === "Failure") expect(result.write.failure).toBe("reject change");
  expect(result.rows).toEqual([]);
});

test("two host connections merge current values under immediate write ownership", async () => {
  const databasePath = await createDatabasePath();
  const finalValue = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* openSqliteDrizzleConnection({
          config: {},
          configureWal: false,
          configureHostDatabase: true,
          databasePath,
        });
        const second = yield* openSqliteDrizzleConnection({
          config: {},
          configureWal: false,
          configureHostDatabase: true,
          databasePath,
        });
        yield* first.session.execute(
          (db) => db.run(sql`CREATE TABLE counter (value INTEGER NOT NULL)`),
          "test.setup",
        );
        yield* first.session.execute(
          (db) => db.run(sql`INSERT INTO counter VALUES (0)`),
          "test.seed",
        );
        const increment = (session: typeof first.session) =>
          session.transaction("test.increment", (transaction) =>
            Effect.gen(function* () {
              const rows = yield* transaction.execute(
                (db) => db.values<[number]>(sql`SELECT value FROM counter`),
                "test.current",
              );
              yield* Effect.yieldNow;
              yield* transaction.execute(
                (db) => db.run(sql`UPDATE counter SET value = ${rows[0]![0] + 1}`),
                "test.increment",
              );
            }),
          );
        yield* Effect.all(
          [first, second].map(({ session }) =>
            Effect.forEach(Array.from({ length: 12 }), () => increment(session)),
          ),
          { concurrency: "unbounded" },
        );
        return yield* first.session.execute(
          (db) => db.values<[number]>(sql`SELECT value FROM counter`),
          "test.result",
        );
      }),
    ),
  );
  expect(finalValue).toEqual([[24]]);
});

test("commit waits asynchronously for a foreign read snapshot", async () => {
  const databasePath = await createDatabasePath();
  let heartbeat = false;
  const rows = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* openSqliteDrizzleConnection({
          config: {},
          configureWal: false,
          configureHostDatabase: true,
          databasePath,
        });
        yield* connection.session.execute(
          (db) => db.run(sql`CREATE TABLE counter (value INTEGER NOT NULL)`),
          "test.setup",
        );
        yield* connection.session.execute(
          (db) => db.run(sql`INSERT INTO counter VALUES (0)`),
          "test.seed",
        );
        const reader = new Database(databasePath);
        reader.exec("BEGIN");
        reader.query("SELECT value FROM counter").all();
        try {
          const updated = yield* Deferred.make<void>();
          const writer = yield* Effect.forkChild(
            connection.session.transaction("test.write", (transaction) =>
              transaction
                .execute((db) => db.run(sql`UPDATE counter SET value = 1`), "test.update")
                .pipe(Effect.andThen(Deferred.succeed(updated, undefined))),
            ),
          );
          yield* Deferred.await(updated);
          yield* Effect.sleep(20);
          heartbeat = true;
          reader.exec("COMMIT");
          yield* Fiber.join(writer);
          return yield* connection.session.execute(
            (db) => db.values<[number]>(sql`SELECT value FROM counter`),
            "test.result",
          );
        } finally {
          reader.close();
        }
      }),
    ),
  );
  expect(heartbeat).toBe(true);
  expect(rows).toEqual([[1]]);
});

test("canceled writes roll back before the next operation", async () => {
  const databasePath = await createDatabasePath();
  const rows = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* openSqliteDrizzleConnection({
          config: {},
          configureWal: false,
          configureHostDatabase: true,
          databasePath,
        });
        yield* connection.session.execute(
          (db) => db.run(sql`CREATE TABLE counter (value INTEGER NOT NULL)`),
          "test.setup",
        );
        const inserted = yield* Deferred.make<void>();
        const writer = yield* Effect.forkChild(
          connection.session.transaction("test.cancel", (transaction) =>
            transaction
              .execute((db) => db.run(sql`INSERT INTO counter VALUES (1)`), "test.insert")
              .pipe(
                Effect.andThen(Deferred.succeed(inserted, undefined)),
                Effect.andThen(Effect.never),
              ),
          ),
        );
        yield* Deferred.await(inserted);
        yield* Fiber.interrupt(writer);
        return yield* connection.session.execute(
          (db) => db.values<[number]>(sql`SELECT value FROM counter`),
          "test.result",
        );
      }),
    ),
  );
  expect(rows).toEqual([]);
});

test("canceling a blocked write does not wait for the foreign writer or run its callback", async () => {
  const databasePath = await createDatabasePath();
  let callbackRan = false;
  let receiptRan = false;
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* openSqliteDrizzleConnection({
          config: {},
          configureWal: false,
          configureHostDatabase: true,
          databasePath,
        });
        yield* connection.session.execute(
          (db) => db.run(sql`CREATE TABLE counter (value INTEGER NOT NULL)`),
          "test.setup",
        );
        const holder = new Database(databasePath);
        holder.exec("BEGIN IMMEDIATE");
        const writer = yield* Effect.forkChild(
          connection.session.transaction("test.blocked", (transaction) =>
            Effect.gen(function* () {
              callbackRan = true;
              yield* transaction.execute(
                (db) => db.run(sql`INSERT INTO counter VALUES (1)`),
                "test.insert",
              );
              yield* transaction.afterCommit(
                Effect.sync(() => {
                  receiptRan = true;
                }),
              );
            }),
          ),
        );
        yield* Effect.sleep(20);
        const interrupted = yield* Fiber.interrupt(writer).pipe(Effect.timeoutOption(100));
        holder.exec("ROLLBACK");
        holder.close();
        yield* Fiber.await(writer);
        const rows = yield* connection.session.execute(
          (db) => db.values<[number]>(sql`SELECT value FROM counter`),
          "test.result",
        );
        return { interrupted, rows };
      }),
    ),
  );
  expect(result.interrupted._tag).toBe("Some");
  expect(callbackRan).toBe(false);
  expect(receiptRan).toBe(false);
  expect(result.rows).toEqual([]);
});

test("after-commit effects see committed data and never run for rolled-back writes", async () => {
  const databasePath = await createDatabasePath();
  const observed: number[] = [];
  const captured: number[] = [];
  const receiptContext = Context.Reference<number>(`test-receipt:${crypto.randomUUID()}`, {
    defaultValue: () => 0,
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* openSqliteDrizzleConnection({
          config: {},
          configureWal: false,
          configureHostDatabase: true,
          databasePath,
        });
        yield* connection.session.execute(
          (db) => db.run(sql`CREATE TABLE counter (value INTEGER NOT NULL)`),
          "test.setup",
        );
        const recordCommitted = Effect.sync(() => {
          const observer = new Database(databasePath, { readonly: true });
          try {
            observed.push(
              observer.query<{ value: number }, []>("SELECT value FROM counter").get()!.value,
            );
          } finally {
            observer.close();
          }
        });
        yield* Effect.result(
          connection.session.transaction("test.rollback", (transaction) =>
            Effect.gen(function* () {
              yield* transaction.execute(
                (db) => db.run(sql`INSERT INTO counter VALUES (7)`),
                "test.insert",
              );
              yield* transaction.afterCommit(recordCommitted);
              return yield* Effect.fail("reject");
            }),
          ),
        );
        yield* connection.session.transaction("test.commit", (transaction) =>
          Effect.gen(function* () {
            yield* transaction.execute(
              (db) => db.run(sql`INSERT INTO counter VALUES (9)`),
              "test.insert",
            );
            yield* transaction
              .afterCommit(
                recordCommitted.pipe(
                  Effect.andThen(
                    Effect.flatMap(receiptContext, (value) =>
                      Effect.sync(() => {
                        captured.push(value);
                      }),
                    ),
                  ),
                ),
              )
              .pipe(Effect.provideService(receiptContext, 42));
          }),
        );
      }),
    ),
  );
  expect(observed).toEqual([9]);
  expect(captured).toEqual([42]);
});

test("a read transaction waits for a foreign exclusive lock", async () => {
  const databasePath = await createDatabasePath();
  const rows = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* openSqliteDrizzleConnection({
          config: {},
          configureWal: false,
          configureHostDatabase: true,
          databasePath,
        });
        yield* connection.session.execute(
          (db) => db.run(sql`CREATE TABLE counter (value INTEGER NOT NULL)`),
          "test.setup",
        );
        const writer = new Database(databasePath);
        writer.exec("BEGIN EXCLUSIVE");
        writer.exec("INSERT INTO counter VALUES (1)");
        try {
          const reader = yield* Effect.forkChild(
            connection.session.readTransaction("test.read", (transaction) =>
              transaction.execute(
                (db) => db.values<[number]>(sql`SELECT value FROM counter`),
                "test.select",
              ),
            ),
          );
          yield* Effect.sleep(30);
          writer.exec("COMMIT");
          return yield* Fiber.join(reader);
        } finally {
          writer.close();
        }
      }),
    ),
  );
  expect(rows).toEqual([[1]]);
});
