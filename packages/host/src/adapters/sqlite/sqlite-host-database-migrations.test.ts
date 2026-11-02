import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { ensureSchema } from "./sqlite-host-database-migrations";
import { hostDatabaseSchema } from "./sqlite-host-database-schema";
import { applyMigrations } from "./sqlite-migrations";

const cleanups = new Set<() => Promise<void>>();
afterEach(async () => {
  await Promise.all(Array.from(cleanups, (cleanup) => cleanup()));
  cleanups.clear();
});

const migrationsFolder = fileURLToPath(new URL("./drizzle-host", import.meta.url));

/** Copies the host migrations and adds one migration with these statements. */
const addMigration = async (directory: string, statements: readonly string[]) => {
  const folder = path.join(directory, "migrations");
  await cp(migrationsFolder, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: Number.MAX_SAFE_INTEGER,
    tag: "9999_test",
    breakpoints: true,
  });
  await writeFile(journalPath, JSON.stringify(journal));
  await writeFile(
    path.join(folder, "9999_test.sql"),
    statements.join("\n--> statement-breakpoint\n"),
  );
  return folder;
};

test("a migration that rebuilds a parent table keeps the child rows", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "odt-host-migration-"));
  cleanups.add(() => rm(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, "database.sqlite");

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* openSqliteDrizzleConnection({
          databasePath,
          configureWal: false,
          configureHostDatabase: true,
          config: { schema: hostDatabaseSchema },
        });
        const { session } = connection;
        const run = (query: string) => session.execute((db) => db.run(sql.raw(query)), "test.run");
        yield* ensureSchema(session, databasePath);
        yield* run(
          `INSERT INTO workspaces (workspace_id, workspace_name, repo_path, branch_prefix, default_target_branch, closed)
           VALUES ('ws', 'Workspace', '/repo', 'odt', 'main', 0)`,
        );
        yield* run(
          `INSERT INTO tasks (workspace_id, id, title, status, issue_type, priority, created_at_ms, updated_at_ms)
           VALUES ('ws', 'ws-1', 'Task', 'open', 'task', 2, 1, 1)`,
        );
        yield* run(
          "INSERT INTO task_labels (workspace_id, task_id, position, label) VALUES ('ws', 'ws-1', 0, 'kept')",
        );
        const [row] = yield* session.execute(
          (db) =>
            db.values<[string]>(
              sql`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'tasks'`,
            ),
          "test.readTasksSql",
        );
        const tasksSql = row?.[0] ?? "";
        const rebuildFolder = yield* Effect.promise(() =>
          addMigration(directory, [
            tasksSql
              .replace(/^CREATE TABLE [`"]?tasks[`"]?/, "CREATE TABLE `__new_tasks`")
              .replaceAll('"tasks".', ""),
            "INSERT INTO `__new_tasks` SELECT * FROM `tasks`",
            "DROP TABLE `tasks`",
            "ALTER TABLE `__new_tasks` RENAME TO `tasks`",
          ]),
        );
        yield* applyMigrations(session, rebuildFolder, databasePath, "exact");
        const labels = yield* session.execute(
          (db) => db.values(sql`SELECT label FROM task_labels`),
          "test.readLabels",
        );
        const foreignKeys = yield* session.execute(
          (db) => db.values(sql`PRAGMA foreign_keys`),
          "test.readForeignKeys",
        );
        return { labels, foreignKeys };
      }),
    ),
  );

  expect(result.labels).toEqual([["kept"]]);
  expect(result.foreignKeys).toEqual([[1]]);
});

test("rejects a database whose applied migration differs from the migration files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "odt-host-migration-"));
  cleanups.add(() => rm(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, "database.sqlite");

  const failure = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { session } = yield* openSqliteDrizzleConnection({
          databasePath,
          configureWal: false,
          configureHostDatabase: true,
          config: { schema: hostDatabaseSchema },
        });
        yield* ensureSchema(session, databasePath);
        yield* session.execute(
          (db) => db.run(sql`UPDATE __drizzle_migrations SET hash = 'changed'`),
          "test.changeHistory",
        );
        return yield* Effect.flip(ensureSchema(session, databasePath));
      }),
    ),
  );

  expect(failure.message).toContain("does not match this OpenDucktor version");
});
