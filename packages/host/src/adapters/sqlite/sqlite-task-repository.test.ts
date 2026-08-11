import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  resolveSqliteTaskStoreDatabasePath,
  TASK_STORE_DATABASE_FILENAME,
} from "../../infrastructure/sqlite/sqlite-task-store-path";
import {
  createPullRequestRecord,
  expectFailureTag,
} from "../../ports/task-store-port-contract.test-support";
import {
  createSqliteTaskStoreHarness,
  insertRawTask,
  readDocumentCount,
  readDrizzleMigrationRows,
  readTableNames,
  readTaskColumnNullability,
} from "./sqlite-task-store-test-support";

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

describe("resolveSqliteTaskStoreDatabasePath", () => {
  test("uses the workspace id literally under the task-stores config root", () => {
    expect(
      Effect.runSync(
        resolveSqliteTaskStoreDatabasePath({
          configDir: "/config",
          workspaceId: "repo-alpha",
        }),
      ),
    ).toBe(path.join("/config", "task-stores", "repo-alpha", TASK_STORE_DATABASE_FILENAME));
  });

  test("builds native task store paths from safe segments", () => {
    expect(
      Effect.runSync(
        resolveSqliteTaskStoreDatabasePath({
          configDir: path.join(path.sep, "home", "dev", ".openducktor"),
          workspaceId: "repo-alpha",
        }),
      ),
    ).toBe(
      path.join(
        path.sep,
        "home",
        "dev",
        ".openducktor",
        "task-stores",
        "repo-alpha",
        "database.sqlite",
      ),
    );
  });

  test("rejects invalid workspace ids instead of normalizing them", async () => {
    for (const workspaceId of [" Repo Alpha ", "Repo-Alpha", "repo/alpha", "repo\\alpha", ".."]) {
      await expectFailureTag(
        resolveSqliteTaskStoreDatabasePath({
          configDir: "/config",
          workspaceId,
        }),
        "HostInvariantError",
      );
    }
  });
});

describe("createSqliteTaskRepository SQLite integration", () => {
  test("diagnoses and initializes a workspace-scoped SQLite database with Drizzle migrations", async () => {
    const { databasePath, repoPath, store } = await createRepositoryHarness();

    await expect(access(databasePath)).rejects.toThrow();
    await expect(Effect.runPromise(store.diagnoseRepoStore({ repoPath }))).resolves.toMatchObject({
      category: "healthy",
      status: "ready",
      isReady: true,
      databasePath,
    });
    await expect(access(databasePath)).resolves.toBeNull();

    await expect(Effect.runPromise(store.diagnoseRepoStore({ repoPath }))).resolves.toMatchObject({
      status: "ready",
    });

    const tableNames = readTableNames(databasePath);
    expect(tableNames).toEqual(
      expect.arrayContaining(["__drizzle_migrations", "task_assets", "task_documents", "tasks"]),
    );
    expect(tableNames).not.toContain("task_store_schema_migrations");
    expect(readDrizzleMigrationRows(databasePath)).toEqual([
      { hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    expect(readDrizzleMigrationRows(databasePath)).toHaveLength(2);
  });

  test("enforces the approved task asset registry shape and cascades task deletion", async () => {
    const { databasePath, repoPath, store } = await createRepositoryHarness();
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "With asset", issueType: "task", aiReviewEnabled: true, priority: 2 },
      }),
    );
    const database = new Database(databasePath);
    database.run("PRAGMA foreign_keys = ON");

    try {
      database
        .query(
          "INSERT INTO task_assets (id, task_id, scope, original_name, media_type, byte_size, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
            "INSERT INTO task_assets (id, task_id, scope, original_name, media_type, byte_size, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            "550e8400-e29b-41d4-a716-446655440001",
            task.id,
            "plan",
            "bad.png",
            "image/png",
            1,
            Date.now(),
          ),
      ).toThrow();
      expect(() =>
        database
          .query(
            "INSERT INTO task_assets (id, task_id, scope, original_name, media_type, byte_size, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
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

    await Effect.runPromise(store.deleteTask({ repoPath, taskId: task.id, deleteSubtasks: false }));
    const verification = new Database(databasePath);
    try {
      const row = verification.query("SELECT count(*) AS count FROM task_assets").get() as {
        count: number;
      };
      expect(row.count).toBe(0);
    } finally {
      verification.close();
    }
  });

  test("generates hash-based task ids with a workspace prefix", async () => {
    const { repoPath, store } = await createRepositoryHarness({
      repoPath: "/repos/Renamed Folder",
      workspaceId: "fairnest",
    });

    const first = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "First", issueType: "feature", priority: 3, aiReviewEnabled: false },
      }),
    );
    const second = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Second", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );

    expect(first.id).toMatch(/^fairnest-[0-9a-z]{4}$/);
    expect(second.id).toMatch(/^fairnest-[0-9a-z]{4}$/);
    expect(second.id).not.toBe(first.id);
  });

  test("rejects a missing parent inside the create transaction", async () => {
    const { repoPath, store } = await createRepositoryHarness();

    await expect(
      Effect.runPromise(
        store.createTask({
          repoPath,
          task: {
            title: "Orphan",
            issueType: "task",
            priority: 2,
            aiReviewEnabled: true,
            parentId: "missing-parent",
          },
        }),
      ),
    ).rejects.toThrow("Task not found: missing-parent");
    expect(await Effect.runPromise(store.listTasks({ repoPath }))).toEqual([]);
  });

  test("rejects a missing parent inside the update transaction", async () => {
    const { repoPath, store } = await createRepositoryHarness();
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Standalone", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );

    await expect(
      Effect.runPromise(
        store.updateTask({
          repoPath,
          taskId: task.id,
          patch: { parentId: "missing-parent" },
        }),
      ),
    ).rejects.toThrow("Task not found: missing-parent");
    expect(await Effect.runPromise(store.getTask({ repoPath, taskId: task.id }))).toMatchObject({
      id: task.id,
      parentId: undefined,
    });
  });

  test("caps generated task id prefixes at ten characters", async () => {
    const { repoPath, store } = await createRepositoryHarness({
      workspaceId: "openducktor-workspace",
    });

    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );

    const prefix = task.id.slice(0, task.id.lastIndexOf("-"));
    expect(prefix).toHaveLength(10);
    expect(task.id).toMatch(/^openduckto-[0-9a-z]{4}$/);
  });

  test("retries task id candidates when SQLite reports an id conflict", async () => {
    const fixedNow = () => new Date("2026-06-10T10:00:00.000Z");
    const { repoPath, store } = await createRepositoryHarness({
      now: fixedNow,
    });

    const first = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );
    const second = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );

    expect(first.id).toMatch(/^fairnest-[0-9a-z]{4}$/);
    expect(second.id).toMatch(/^fairnest-[0-9a-z]{4}$/);
    expect(second.id).not.toBe(first.id);
  });

  test("enforces SQLite constraints for boolean and enum task columns", async () => {
    const { databasePath, repoPath, store } = await createRepositoryHarness();

    await Effect.runPromise(store.diagnoseRepoStore({ repoPath }));
    expect(() =>
      insertRawTask({
        databasePath,
        qaRequired: 2,
        taskId: "fairnest-invalid-boolean",
      }),
    ).toThrow();
    expect(() =>
      insertRawTask({
        databasePath,
        status: "done-ish",
        taskId: "fairnest-invalid-status",
      }),
    ).toThrow();
    expect(() =>
      insertRawTask({
        databasePath,
        issueType: "story",
        taskId: "fairnest-invalid-issue-type",
      }),
    ).toThrow();
  });

  test("stores task descriptions as optional task data", async () => {
    const { databasePath, repoPath, store } = await createRepositoryHarness();

    await Effect.runPromise(store.diagnoseRepoStore({ repoPath }));

    expect(readTaskColumnNullability(databasePath, "description")).toBe(true);
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );
    expect(task.description).toBe("");
  });

  test("wraps raw SQLite execution failures as operation errors", async () => {
    const { databasePath, repoPath, store } = await createRepositoryHarness();
    await mkdir(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    try {
      database.exec("create table tasks (id text primary key);");
    } finally {
      database.close();
    }

    const failure = await expectFailureTag(store.listTasks({ repoPath }), "HostOperationError");
    expect(failure).toBeInstanceOf(HostOperationError);
    if (failure instanceof HostOperationError) {
      expect(failure.operation).toBe("sqliteTaskRepository.ensureSchema");
    }
  });

  test("stores document history in SQLite while task metadata reads the latest revision", async () => {
    const { databasePath, repoPath, store } = await createRepositoryHarness();
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );

    await Effect.runPromise(
      store.setSpecDocument({
        repoPath,
        taskId: task.id,
        markdown: " # First spec ",
      }),
    );
    const latestSpec = await Effect.runPromise(
      store.setSpecDocument({
        repoPath,
        taskId: task.id,
        markdown: "# Second spec",
      }),
    );
    const metadata = await Effect.runPromise(store.getTaskMetadata({ repoPath, taskId: task.id }));

    expect(latestSpec).toMatchObject({ markdown: "# Second spec", revision: 2 });
    expect(metadata.spec).toMatchObject({ markdown: "# Second spec", revision: 2 });
    expect(readDocumentCount(databasePath, task.id, "spec")).toBe(2);
  });

  test("persists pull-request JSON as valid task metadata", async () => {
    const { repoPath, store } = await createRepositoryHarness();
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );
    const pullRequest = createPullRequestRecord();

    await Effect.runPromise(store.setPullRequest({ repoPath, taskId: task.id, pullRequest }));

    await expect(
      Effect.runPromise(store.getTaskMetadata({ repoPath, taskId: task.id })),
    ).resolves.toMatchObject({ pullRequest });
  });

  test("lists only open and draft pull request sync candidates", async () => {
    const { repoPath, store } = await createRepositoryHarness();
    const createTask = (title: string) =>
      Effect.runPromise(
        store.createTask({
          repoPath,
          task: { title, issueType: "task", priority: 2, aiReviewEnabled: true },
        }),
      );

    const openTask = await createTask("Open pull request");
    const draftTask = await createTask("Draft pull request");
    const closedTask = await createTask("Closed task");
    const mergedTask = await createTask("Merged pull request");
    await createTask("No pull request");

    await Effect.runPromise(
      store.setPullRequest({
        repoPath,
        taskId: openTask.id,
        pullRequest: createPullRequestRecord({ number: 41, state: "open" }),
      }),
    );
    await Effect.runPromise(
      store.setPullRequest({
        repoPath,
        taskId: draftTask.id,
        pullRequest: createPullRequestRecord({ number: 42, state: "draft" }),
      }),
    );
    await Effect.runPromise(
      store.setPullRequest({
        repoPath,
        taskId: closedTask.id,
        pullRequest: createPullRequestRecord({ number: 43, state: "open" }),
      }),
    );
    await Effect.runPromise(
      store.transitionTask({ repoPath, taskId: closedTask.id, status: "closed" }),
    );
    await Effect.runPromise(
      store.setPullRequest({
        repoPath,
        taskId: mergedTask.id,
        pullRequest: createPullRequestRecord({ number: 44, state: "merged" }),
      }),
    );

    const candidates = await Effect.runPromise(store.listPullRequestSyncCandidates({ repoPath }));

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
