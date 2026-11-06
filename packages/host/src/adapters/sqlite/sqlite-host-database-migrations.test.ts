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

/** Copies the host migrations up to and including the migration at this index. */
const copyMigrationsUpTo = async (directory: string, lastIndex: number) => {
  const folder = path.join(directory, `migrations-${lastIndex}`);
  await cp(migrationsFolder, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  journal.entries = journal.entries.slice(0, lastIndex + 1);
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
};

test("0002 moves prompt overrides to their owners, Autopilot rules to the built-in workflow, and renames the cleanup commands", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "odt-host-migration-"));
  cleanups.add(() => rm(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, "database.sqlite");
  const initialFolder = await copyMigrationsUpTo(directory, 1);

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { session } = yield* openSqliteDrizzleConnection({
          databasePath,
          configureWal: false,
          configureHostDatabase: true,
          config: { schema: hostDatabaseSchema },
        });
        const run = (query: string) => session.execute((db) => db.run(sql.raw(query)), "test.run");
        const read = (query: string) =>
          session.execute((db) => db.values(sql.raw(query)), "test.read");
        yield* applyMigrations(session, initialFolder, databasePath, "exact");
        yield* run(
          `INSERT INTO workspaces (workspace_id, workspace_name, repo_path, branch_prefix, default_target_branch, closed)
           VALUES ('ws', 'Workspace', '/repo', 'odt', 'main', 0)`,
        );
        yield* run(
          `INSERT INTO workspace_build_completion_commands (workspace_id, position, command) VALUES
           ('ws', 0, 'docker compose down'),
           ('ws', 1, 'rm -rf .cache')`,
        );
        yield* run(
          `INSERT INTO global_prompt_overrides (template_id, template, base_version, enabled) VALUES
           ('system.role.build.base', 'global build', 1, 1),
           ('system.shared.workflow_guards', 'global guards', 2, 0),
           ('kickoff.qa_review', 'global kickoff', 3, NULL),
           ('kickoff.build_pull_request_generation', 'global pull request', 5, 1)`,
        );
        yield* run(
          `INSERT INTO workspace_prompt_overrides (workspace_id, template_id, template, base_version, enabled) VALUES
           ('ws', 'system.role.qa.base', 'workspace qa', 1, 1),
           ('ws', 'message.build_rebase_conflict_resolution', 'workspace message', 4, 0),
           ('ws', 'kickoff.build_pull_request_generation', 'workspace pull request', 6, 1)`,
        );
        yield* run(
          `INSERT INTO autopilot_rules (workflow_id, event_id) VALUES
           ('openducktor', 'taskProgressedToSpecReady'),
           ('custom', 'taskProgressedToSpecReady')`,
        );
        yield* run(
          `INSERT INTO autopilot_rule_actions (workflow_id, event_id, position, action_id) VALUES
           ('openducktor', 'taskProgressedToSpecReady', 0, 'startPlanner'),
           ('openducktor', 'taskProgressedToSpecReady', 1, 'startBuilder'),
           ('custom', 'taskProgressedToSpecReady', 0, 'startPlanner')`,
        );
        yield* ensureSchema(session, databasePath);
        return {
          globalOverrides: yield* read(
            "SELECT owner_kind, owner_id, prompt_id, template, base_version, enabled FROM global_prompt_overrides ORDER BY owner_kind, prompt_id",
          ),
          workspaceOverrides: yield* read(
            "SELECT workspace_id, owner_kind, owner_id, prompt_id, template, base_version, enabled FROM workspace_prompt_overrides ORDER BY owner_kind, prompt_id",
          ),
          rules: yield* read(
            "SELECT workflow_id, event_id FROM autopilot_rules ORDER BY workflow_id",
          ),
          actions: yield* read(
            "SELECT workflow_id, event_id, position, action_id FROM autopilot_rule_actions ORDER BY workflow_id, position",
          ),
          worktreeRemovalCommands: yield* read(
            "SELECT workspace_id, position, command FROM workspace_before_worktree_removal_commands ORDER BY position",
          ),
          foreignKeyViolations: yield* read("PRAGMA foreign_key_check"),
        };
      }),
    ),
  );

  const specPlanBuild = "openducktor-spec-plan-build";
  expect(result.globalOverrides).toEqual([
    ["role", "build", "instructions", "global build", 1, 1],
    ["workflow", specPlanBuild, "messages.pull_request", "global pull request", 5, 1],
    ["workflow", specPlanBuild, "messages.qa_review", "global kickoff", 3, null],
    ["workflow", specPlanBuild, "workflow.rules", "global guards", 2, 0],
  ]);
  expect(result.workspaceOverrides).toEqual([
    ["ws", "role", "qa", "instructions", "workspace qa", 1, 1],
    ["ws", "workflow", specPlanBuild, "messages.build_git_conflict", "workspace message", 4, 0],
    ["ws", "workflow", specPlanBuild, "messages.pull_request", "workspace pull request", 6, 1],
  ]);
  expect(result.rules).toEqual([
    ["custom", "taskProgressedToSpecReady"],
    [specPlanBuild, "taskProgressedToSpecReady"],
  ]);
  expect(result.worktreeRemovalCommands).toEqual([
    ["ws", 0, "docker compose down"],
    ["ws", 1, "rm -rf .cache"],
  ]);
  expect(result.actions).toEqual([
    ["custom", "taskProgressedToSpecReady", 0, "startPlanner"],
    [specPlanBuild, "taskProgressedToSpecReady", 0, "startPlanner"],
    [specPlanBuild, "taskProgressedToSpecReady", 1, "startBuilder"],
  ]);
  expect(result.foreignKeyViolations).toEqual([]);
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
