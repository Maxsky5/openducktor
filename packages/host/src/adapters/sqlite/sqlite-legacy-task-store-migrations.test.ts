import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { ensureLegacySchema, legacyMigrationsFolder } from "./sqlite-legacy-task-store-migrations";
import { legacyTaskStoreSchema, tasks as legacyTasks } from "./sqlite-legacy-task-store-schema";
import {
  createLegacyTaskStore,
  insertLegacyTask,
  readTaskColumnNullability,
} from "./sqlite-task-store-test-support";

const cleanups = new Set<() => Promise<void>>();
const createLegacyHarness = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "odt-legacy-migration-"));
  cleanups.add(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "database.sqlite");
};
const normalizeLegacyStore = (databasePath: string, deleteTaskId?: string) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* openSqliteDrizzleConnection({
          databasePath,
          config: { schema: legacyTaskStoreSchema },
          configureWal: false,
        });
        yield* ensureLegacySchema(connection.session, databasePath);
        if (deleteTaskId)
          yield* connection.session.execute(
            (db) => db.delete(legacyTasks).where(eq(legacyTasks.id, deleteTaskId)),
            "test.delete",
          );
        return yield* connection.session.execute(
          (db) => db.select().from(legacyTasks),
          "test.read",
        );
      }),
    ),
  );
afterEach(async () => {
  await Promise.all(Array.from(cleanups, (cleanup) => cleanup()));
  cleanups.clear();
});

const insertLegacyWorkflowArtifact = (
  databasePath: string,
  taskId: string,
  kind: "spec" | "implementation_plan" | "qa_report",
  verdict: string | null = null,
) => {
  const database = new Database(databasePath);
  try {
    database.run(
      `insert into tasks_artifacts (
          artifact_id, task_id, classification, workflow_kind, revision, name, markdown, format, verdict
        ) values (?, ?, 'workflow', ?, 1, 'Artifact', '# Artifact', 'plain_text', ?)`,
      [`workflow:${taskId}:${kind}`, taskId, kind, verdict],
    );
  } finally {
    database.close();
  }
};
const insertLegacySpec = (databasePath: string, taskId: string) =>
  insertLegacyWorkflowArtifact(databasePath, taskId, "spec");

const readWorkflowArtifactRows = (databasePath: string) => {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database
      .query(
        "select artifact_id, code, verdict from tasks_artifacts where classification = 'workflow' order by code",
      )
      .all();
  } finally {
    database.close();
  }
};

const readLegacyWorkflowArtifactCount = (databasePath: string, taskId: string, code: string) => {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database
      .query(
        "select artifact_id from tasks_artifacts where task_id = ? and classification = 'workflow' and code = ?",
      )
      .all(taskId, code).length;
  } finally {
    database.close();
  }
};

describe("generic task workflow migration", () => {
  test("stores each legacy workflow artifact by its workflow code", async () => {
    const databasePath = await createLegacyHarness();
    await createLegacyTaskStore(databasePath, 9);
    insertLegacyTask({ databasePath, taskId: "task-1", status: "human_review" });
    insertLegacyWorkflowArtifact(databasePath, "task-1", "spec");
    insertLegacyWorkflowArtifact(databasePath, "task-1", "implementation_plan");
    insertLegacyWorkflowArtifact(databasePath, "task-1", "qa_report", "approved");

    const [task] = await normalizeLegacyStore(databasePath);

    expect(readWorkflowArtifactRows(databasePath)).toEqual([
      { artifact_id: "workflow:task-1:plan", code: "plan", verdict: null },
      { artifact_id: "workflow:task-1:qaReport", code: "qaReport", verdict: "approved" },
      { artifact_id: "workflow:task-1:spec", code: "spec", verdict: null },
    ]);
    expect(task?.status).toBe("human_review");
  });
});

describe("tasks table migration without hierarchy and QA columns", () => {
  test("keeps tasks and their artifacts, and turns epics into features", async () => {
    const databasePath = await createLegacyHarness();
    await createLegacyTaskStore(databasePath, 9);
    insertLegacyTask({ databasePath, taskId: "epic-1", issueType: "epic" });
    insertLegacyTask({ databasePath, taskId: "child-1", parentId: "epic-1", status: "spec_ready" });
    insertLegacyTask({ databasePath, taskId: "task-2", qaRequired: 0, status: "in_progress" });
    insertLegacySpec(databasePath, "child-1");

    const tasks = await normalizeLegacyStore(databasePath);

    expect(
      tasks.map(({ id, issueType, status }) => ({ id, issueType, status })).toSorted(),
    ).toEqual(
      expect.arrayContaining([
        { id: "epic-1", issueType: "feature", status: "open" },
        { id: "child-1", issueType: "task", status: "spec_ready" },
        { id: "task-2", issueType: "task", status: "in_progress" },
      ]),
    );
    expect(tasks).toHaveLength(3);
    expect(readLegacyWorkflowArtifactCount(databasePath, "child-1", "spec")).toBe(1);
    expect(readTaskColumnNullability(databasePath, "parent_id")).toBeUndefined();
    expect(readTaskColumnNullability(databasePath, "qa_required")).toBeUndefined();
  });

  test("turns foreign keys back on after the migration", async () => {
    const databasePath = await createLegacyHarness();
    await createLegacyTaskStore(databasePath, 9);
    insertLegacyTask({ databasePath, taskId: "task-1" });
    insertLegacySpec(databasePath, "task-1");

    await normalizeLegacyStore(databasePath, "task-1");

    expect(readLegacyWorkflowArtifactCount(databasePath, "task-1", "spec")).toBe(0);
  });
});

describe("legacy migration history", () => {
  test("records each applied migration with the hash and time of its file", async () => {
    const databasePath = await createLegacyHarness();
    await createLegacyTaskStore(databasePath, 9);

    await normalizeLegacyStore(databasePath);

    const database = new Database(databasePath, { readonly: true });
    try {
      expect(
        database
          .query("select hash, created_at from __drizzle_migrations order by created_at")
          .all(),
      ).toEqual(
        readMigrationFiles({ migrationsFolder: legacyMigrationsFolder }).map((migration) => ({
          hash: migration.hash,
          created_at: migration.folderMillis,
        })),
      );
    } finally {
      database.close();
    }
  });

  // main added `0007_session_speed` (1791412497201) in f2f11b879 and deleted it in 05f51b065.
  test("accepts a main history that holds a deleted migration", async () => {
    const databasePath = await createLegacyHarness();
    await createLegacyTaskStore(databasePath, 6);
    const database = new Database(databasePath);
    try {
      database.run("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
        "e7c7def63565ea65",
        1791412497201,
      ]);
    } finally {
      database.close();
    }

    await normalizeLegacyStore(databasePath);

    const migrated = new Database(databasePath, { readonly: true });
    try {
      expect(migrated.query("select count(*) as count from __drizzle_migrations").get()).toEqual({
        count: readMigrationFiles({ migrationsFolder: legacyMigrationsFolder }).length + 1,
      });
    } finally {
      migrated.close();
    }
  });

  test("rejects a history newer than every known migration", async () => {
    const databasePath = await createLegacyHarness();
    await createLegacyTaskStore(databasePath, 11);
    const newest = readMigrationFiles({ migrationsFolder: legacyMigrationsFolder }).at(-1);
    const database = new Database(databasePath);
    try {
      database.run("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
        "newer",
        (newest?.folderMillis ?? 0) + 1,
      ]);
    } finally {
      database.close();
    }

    await expect(normalizeLegacyStore(databasePath)).rejects.toThrow(
      "does not match this OpenDucktor version",
    );
  });

  test("rejects a database that has tables but no migration history", async () => {
    const databasePath = await createLegacyHarness();
    const database = new Database(databasePath);
    try {
      database.exec("create table tasks (id text primary key)");
    } finally {
      database.close();
    }

    await expect(normalizeLegacyStore(databasePath)).rejects.toThrow(
      "The database has tables but no supported migration history.",
    );
  });
});
