import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createDirectMergeRecord } from "../../ports/task-store-port-contract-fixtures";
import {
  createPullRequestRecord,
  expectFailureTag,
} from "../../ports/task-store-port-contract.test-support";
import {
  createSqliteTaskStoreHarness,
  insertRawTask,
  readWorkflowArtifactCount,
  readDrizzleMigrationRows,
  readTableNames,
  readTaskColumnNullability,
} from "./sqlite-task-store-test-support";
import { openHostDatabaseConnection } from "./sqlite-host-database-connection";

const cleanups = new Set<() => Promise<void>>();

const createRepositoryHarness = async (
  input?: Parameters<typeof createSqliteTaskStoreHarness>[0],
) => {
  const harness = await createSqliteTaskStoreHarness(input);
  cleanups.add(harness.cleanup);
  return harness;
};

afterEach(async () => {
  const pendingCleanups = Array.from(cleanups);
  cleanups.clear();
  await Promise.all(pendingCleanups.map((cleanup) => cleanup()));
});

describe("createSqliteTaskRepository SQLite integration", () => {
  test("disables disk sync only on disposable fixture connections", async () => {
    const harness = await createRepositoryHarness();
    const settingsQuery = sql`
      SELECT synchronous, foreign_keys, journal_mode
      FROM pragma_synchronous, pragma_foreign_keys, pragma_journal_mode
    `;
    const fixtureSettings = await Effect.runPromise(
      harness.contextProvider(harness.scope, "test.fixtureSettings", ({ session }) =>
        session.execute((database) => database.values(settingsQuery), "test.fixtureSettings"),
      ),
    );
    expect(fixtureSettings).toEqual([[0, 1, "wal"]]);

    const production = await Effect.runPromise(
      openHostDatabaseConnection(path.join(harness.configDir, "production.sqlite")),
    );
    try {
      const settings = await Effect.runPromise(
        production.session.execute(
          (database) => database.values(settingsQuery),
          "test.productionSettings",
        ),
      );
      expect(settings).toEqual([[3, 1, "delete"]]);
      expect(settings).not.toEqual([[0, 1, "wal"]]);
    } finally {
      await Effect.runPromise(production.release);
    }
  });

  test("disposes retained connections when the test harness is cleaned up", async () => {
    const { cleanup, scope, store } = await createRepositoryHarness();
    await Effect.runPromise(store.listTasks(scope));

    await cleanup();

    await expect(Effect.runPromise(store.listTasks(scope))).rejects.toThrow(
      "The host database is stopping and cannot accept a new operation.",
    );
  });

  test("diagnoses and initializes a host SQLite database with Drizzle migrations", async () => {
    const { databasePath, scope, store } = await createRepositoryHarness();

    await expect(access(databasePath)).rejects.toThrow();
    await expect(Effect.runPromise(store.diagnoseRepoStore(scope))).resolves.toMatchObject({
      category: "healthy",
      status: "ready",
      isReady: true,
      databasePath,
    });
    await expect(access(databasePath)).resolves.toBeNull();

    await expect(Effect.runPromise(store.diagnoseRepoStore(scope))).resolves.toMatchObject({
      status: "ready",
    });

    const tableNames = readTableNames(databasePath);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "__drizzle_migrations",
        "task_artifacts",
        "task_assets",
        "tasks",
        "workspace_sessions",
      ]),
    );
    expect(tableNames).not.toContain("task_store_schema_migrations");
    expect(tableNames).not.toContain("task_documents");
    expect(readDrizzleMigrationRows(databasePath)).toEqual([
      { hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    const database = new Database(databasePath);
    try {
      const journalMode = database
        .query<{ journal_mode: string }, []>("PRAGMA journal_mode;")
        .get();
      expect(journalMode?.journal_mode).toBe("wal");
    } finally {
      database.close();
    }
  });

  test("shares directory and schema initialization across concurrent first operations", async () => {
    const { databasePath, scope, store } = await createRepositoryHarness();

    const results = await Effect.runPromise(
      Effect.all(
        Array.from({ length: 8 }, () => store.listTasks(scope)),
        { concurrency: "unbounded" },
      ),
    );

    expect(results).toEqual(Array.from({ length: 8 }, () => []));
    expect(readDrizzleMigrationRows(databasePath)).toHaveLength(3);
  });

  test("enforces the approved task asset registry shape and cascades task deletion", async () => {
    const { databasePath, scope, store } = await createRepositoryHarness();
    const task = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "With asset", issueType: "task", priority: 2 },
      }),
    );
    const database = new Database(databasePath);
    database.run("PRAGMA foreign_keys = ON");

    try {
      database
        .query(
          "INSERT INTO task_assets (workspace_id, id, task_id, scope, original_name, media_type, byte_size, created_at_ms) VALUES ('fairnest', ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "550e8400-e29b-41d4-a716-446655440000",
          task.id,
          "description",
          "diagram.png",
          "image/png",
          12,
          Date.now(),
        );

      expect(() =>
        database
          .query(
            "INSERT INTO task_assets (workspace_id, id, task_id, scope, original_name, media_type, byte_size, created_at_ms) VALUES ('fairnest', ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            "550e8400-e29b-41d4-a716-446655440002",
            task.id,
            "description",
            "bad.png",
            "image/png",
            -1,
            Date.now(),
          ),
      ).toThrow();
    } finally {
      database.close();
    }

    await Effect.runPromise(store.deleteTask({ ...scope, taskId: task.id }));
    const verification = new Database(databasePath);
    try {
      const row = verification
        .query<{ count: number }, []>("SELECT count(*) AS count FROM task_assets")
        .get();
      expect(row?.count).toBe(0);
    } finally {
      verification.close();
    }
  });

  test("generates hash-based task ids with a workspace prefix", async () => {
    const { scope, store } = await createRepositoryHarness({
      repoPath: "/repos/Renamed Folder",
      workspaceId: "fairnest",
    });

    const first = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "First", issueType: "feature", priority: 3 },
      }),
    );
    const second = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "Second", issueType: "task", priority: 2 },
      }),
    );

    expect(first.id).toMatch(/^fairnest-[0-9a-z]{4}$/);
    expect(second.id).toMatch(/^fairnest-[0-9a-z]{4}$/);
    expect(second.id).not.toBe(first.id);
  });

  test("stores the worktree cleanup value of a task as 1, 0, or NULL", async () => {
    const { databasePath, scope, store } = await createRepositoryHarness();
    const created = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "Keep", issueType: "task", priority: 2, removeWorktreeOnClose: false },
      }),
    );
    const stored = () => {
      const database = new Database(databasePath, { readonly: true });
      try {
        return database
          .query<{ value: number | null }, [string]>(
            "SELECT remove_worktree_on_close AS value FROM tasks WHERE id = ?",
          )
          .get(created.id)?.value;
      } finally {
        database.close();
      }
    };
    const update = (removeWorktreeOnClose: boolean | null) =>
      Effect.runPromise(
        store.updateTask({ ...scope, taskId: created.id, patch: { removeWorktreeOnClose } }),
      );

    expect(created.removeWorktreeOnClose).toBe(false);
    expect(stored()).toBe(0);
    expect((await update(true)).removeWorktreeOnClose).toBe(true);
    expect(stored()).toBe(1);
    // Null follows the global setting again.
    expect((await update(null)).removeWorktreeOnClose).toBeNull();
    expect(stored()).toBeNull();
  });

  test("caps generated task id prefixes at ten characters", async () => {
    const { scope, store } = await createRepositoryHarness({
      workspaceId: "openducktor-workspace",
    });

    const task = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );

    const prefix = task.id.slice(0, task.id.lastIndexOf("-"));
    expect(prefix).toHaveLength(10);
    expect(task.id).toMatch(/^openduckto-[0-9a-z]{4}$/);
  });

  test("retries task id candidates when SQLite reports an id conflict", async () => {
    const fixedNow = () => new Date("2026-06-10T10:00:00.000Z");
    const { scope, store } = await createRepositoryHarness({
      now: fixedNow,
    });

    const first = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    const second = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );

    expect(first.id).toMatch(/^fairnest-[0-9a-z]{4}$/);
    expect(second.id).toMatch(/^fairnest-[0-9a-z]{4}$/);
    expect(second.id).not.toBe(first.id);
  });

  test("stores any non-blank workflow status and issue type", async () => {
    const { databasePath, scope, store } = await createRepositoryHarness();

    await Effect.runPromise(store.diagnoseRepoStore(scope));
    insertRawTask({ databasePath, status: "reviewing", taskId: "fairnest-review-status" });
    insertRawTask({ databasePath, issueType: "article", taskId: "fairnest-article" });
    expect(() =>
      insertRawTask({ databasePath, status: " ", taskId: "fairnest-blank-status" }),
    ).toThrow();
    expect(() =>
      insertRawTask({ databasePath, issueType: "", taskId: "fairnest-blank-issue-type" }),
    ).toThrow();
  });

  test("stores task descriptions as optional task data", async () => {
    const { databasePath, scope, store } = await createRepositoryHarness();

    await Effect.runPromise(store.diagnoseRepoStore(scope));

    expect(readTaskColumnNullability(databasePath, "description")).toBe(true);
    const task = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    expect(task.description).toBe("");
  });

  test("reads task target branches from typed columns", async () => {
    const { databasePath, scope, store } = await createRepositoryHarness();
    const task = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    const database = new Database(databasePath);
    try {
      database
        .query("UPDATE tasks SET target_branch = 'main', target_remote = 'origin' WHERE id = ?")
        .run(task.id);
    } finally {
      database.close();
    }

    const targetBranch = { remote: "origin", branch: "main" };
    const tasks = await Effect.runPromise(store.listTasks(scope));
    expect(tasks.find((item) => item.id === task.id)?.targetBranch).toEqual(targetBranch);
    const metadata = await Effect.runPromise(store.getTaskMetadata({ ...scope, taskId: task.id }));
    expect(metadata.targetBranch).toEqual(targetBranch);
  });

  test("wraps raw SQLite execution failures as operation errors", async () => {
    const { databasePath, scope, store } = await createRepositoryHarness();
    await mkdir(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    try {
      database.exec("create table tasks (id text primary key);");
    } finally {
      database.close();
    }

    const failure = await expectFailureTag(store.listTasks(scope), "HostOperationError");
    expect(failure).toBeInstanceOf(HostOperationError);
    if (failure instanceof HostOperationError) {
      // The migrator runs each query through Effect.runPromise, which rejects with the typed error.
      expect(failure.operation).toBe("sqliteHost.migrate");
    }
  });

  test("stores workflow artifact history in SQLite while task metadata reads the latest revision", async () => {
    const { databasePath, scope, store } = await createRepositoryHarness();
    const task = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );

    await Effect.runPromise(
      store.saveWorkflowArtifact({
        decide: (current) =>
          Result.succeed({
            status: current.status,
            workflowId: "openducktor-spec-plan-build",
          }),
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        taskId: task.id,
        markdown: " # First spec ",
        code: "spec",
      }),
    );
    const latestSpec = await Effect.runPromise(
      store.saveWorkflowArtifact({
        decide: (current) =>
          Result.succeed({
            status: current.status,
            workflowId: "openducktor-spec-plan-build",
          }),
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        taskId: task.id,
        markdown: "# Second spec",
        code: "spec",
      }),
    );
    const metadata = await Effect.runPromise(store.getTaskMetadata({ ...scope, taskId: task.id }));

    expect(latestSpec.artifact).toMatchObject({ markdown: "# Second spec", revision: 2 });
    expect(metadata.artifacts.spec).toMatchObject({ markdown: "# Second spec", revision: 2 });
    expect(readWorkflowArtifactCount(databasePath, task.id, "spec")).toBe(2);
  });

  test("updates delivery records without deleting and inserting their rows", async () => {
    const { scope, store, withHostDatabase } = await createRepositoryHarness();
    const changes = async () => {
      const rows = await Effect.runPromise(
        withHostDatabase("test.deliveryChanges", (session) =>
          session.execute(
            (db) => db.values<[number]>(sql`select total_changes()`),
            "test.deliveryChanges",
          ),
        ),
      );
      return rows[0]![0];
    };
    const task = await Effect.runPromise(
      store.createTask({
        ...scope,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    const pullRequest = createPullRequestRecord();
    await Effect.runPromise(
      store.setPullRequest({
        ...scope,
        taskId: task.id,
        pullRequest: {
          ...pullRequest,
          repositoryIdentity: "repository",
          lastSyncedAt: "2026-01-01T00:00:01.000Z",
          mergedAt: "2026-01-01T00:00:02.000Z",
          closedAt: "2026-01-01T00:00:03.000Z",
        },
      }),
    );
    const beforePullRequest = await changes();
    await Effect.runPromise(store.setPullRequest({ ...scope, taskId: task.id, pullRequest }));
    expect((await changes()) - beforePullRequest).toBe(2);
    expect(
      (await Effect.runPromise(store.getTaskMetadata({ ...scope, taskId: task.id }))).pullRequest,
    ).toEqual(pullRequest);
    const directMerge = createDirectMergeRecord();
    await Effect.runPromise(
      store.setDirectMerge({
        ...scope,
        taskId: task.id,
        directMerge: {
          ...directMerge,
          targetBranch: { ...directMerge.targetBranch, remote: "origin" },
        },
      }),
    );
    const beforeDirectMerge = await changes();
    await Effect.runPromise(store.setDirectMerge({ ...scope, taskId: task.id, directMerge }));
    expect((await changes()) - beforeDirectMerge).toBe(2);
    expect(
      (await Effect.runPromise(store.getTaskMetadata({ ...scope, taskId: task.id }))).directMerge,
    ).toEqual(directMerge);
  });

  test("lists only open and draft pull request sync candidates", async () => {
    const { scope, store } = await createRepositoryHarness();
    const createTask = (title: string) =>
      Effect.runPromise(
        store.createTask({
          ...scope,
          status: "open",
          task: { title, issueType: "task", priority: 2 },
        }),
      );

    const openTask = await createTask("Open pull request");
    const draftTask = await createTask("Draft pull request");
    const closedTask = await createTask("Closed task");
    const mergedTask = await createTask("Merged pull request");
    await createTask("No pull request");

    await Effect.runPromise(
      store.setPullRequest({
        ...scope,
        taskId: openTask.id,
        pullRequest: createPullRequestRecord({ number: 41, state: "open" }),
      }),
    );
    await Effect.runPromise(
      store.setPullRequest({
        ...scope,
        taskId: draftTask.id,
        pullRequest: createPullRequestRecord({ number: 42, state: "draft" }),
      }),
    );
    await Effect.runPromise(
      store.setPullRequest({
        ...scope,
        taskId: closedTask.id,
        pullRequest: createPullRequestRecord({ number: 43, state: "open" }),
      }),
    );
    await Effect.runPromise(
      store.transitionTask({
        ...scope,
        taskId: closedTask.id,
        decide: () =>
          Result.succeed({ status: "closed", workflowId: "openducktor-spec-plan-build" }),
      }),
    );
    await Effect.runPromise(
      store.setPullRequest({
        ...scope,
        taskId: mergedTask.id,
        pullRequest: createPullRequestRecord({ number: 44, state: "merged" }),
      }),
    );

    const candidates = await Effect.runPromise(store.listPullRequestSyncCandidates(scope));

    expect(candidates.map((candidate) => candidate.id).sort()).toEqual(
      [draftTask.id, openTask.id].sort(),
    );
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: openTask.id,
          pullRequest: expect.objectContaining({ state: "open" }),
        }),
        expect.objectContaining({
          id: draftTask.id,
          pullRequest: expect.objectContaining({ state: "draft" }),
        }),
      ]),
    );
  });
});
