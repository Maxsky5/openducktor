import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { TASK_ARTIFACT_MAX_FILE_BYTES, workflowArtifactId } from "@openducktor/contracts";
import { Effect } from "effect";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import {
  type SqliteValue,
  sqliteValueSchema,
} from "../../infrastructure/sqlite/sqlite-driver-values";
import { createSqliteTaskRepository } from "./sqlite-task-repository";
import { taskStoreSchema } from "./sqlite-task-store-schema";
import {
  createLegacyTaskStore,
  createSqliteTaskStoreHarness,
  insertLegacyTask,
  readDrizzleMigrationRows,
  readTableNames,
} from "./sqlite-task-store-test-support";

const cleanups = new Set<() => Promise<void>>();
const createHarness = async () => {
  const harness = await createSqliteTaskStoreHarness();
  cleanups.add(harness.cleanup);
  return harness;
};
afterEach(async () => {
  await Promise.all(Array.from(cleanups, (cleanup) => cleanup()));
  cleanups.clear();
});

const createTaskHarness = async () => {
  const harness = await createHarness();
  const task = await Effect.runPromise(
    harness.store.createTask({
      repoPath: harness.repoPath,
      status: "open",
      task: { title: "Artifact task", issueType: "task", priority: 2 },
    }),
  );
  return { ...harness, task, scope: { repoPath: harness.repoPath, taskId: task.id } };
};
const file = {
  name: "Specification",
  fileName: "output.bin",
  mediaType: "application/octet-stream",
  content: Uint8Array.from([0, 255, 10, 13, 127]),
};

const openFixtureDatabase = (databasePath: string) => {
  const database = new Database(databasePath);
  database.exec("PRAGMA synchronous = OFF");
  return database;
};

/** Migration 0009 drops parent_id and qa_required; every other task column keeps its value. */
const KEPT_TASK_COLUMNS =
  "id, title, description, status, issue_type, priority, labels_json, agent_sessions_json, target_branch_json, pull_request_json, source_provider_id, source_scope, source_id, source_number, source_url, direct_merge_json, created_at_ms, updated_at_ms";

const createLegacyStore = (databasePath: string, migrationCount = 7) =>
  createLegacyTaskStore(databasePath, migrationCount);

describe("task artifact migration", () => {
  test("preserves every legacy revision, exact Markdown, null fields and provenance without changing tasks", async () => {
    const { databasePath, repoPath, store } = await createHarness();
    await createLegacyStore(databasePath);
    insertLegacyTask({ databasePath, taskId: "legacy", status: "human_review" });
    const database = openFixtureDatabase(databasePath);
    const rows = [
      ["spec", -1, "  \ufeff# First\r\n\r\n", "plain_text", null, null, null, null],
      [
        "spec",
        3,
        "\ufeff# Current\r\n  ",
        "plain_text",
        null,
        "odt_set_spec",
        "spec-agent",
        1730000000000,
      ],
      [
        "implementation_plan",
        7,
        "# Plan\n",
        "plain_text",
        "approved",
        "legacy-tool",
        "old-user",
        null,
      ],
      [
        "qa_report",
        2,
        "# Rejected\n",
        "plain_text",
        "rejected",
        "odt_qa_rejected",
        "qa-agent",
        1730000000010,
      ],
      [
        "qa_report",
        5,
        "# Approved\n",
        "plain_text",
        "approved",
        "odt_qa_approved",
        "qa-agent",
        1730000000020,
      ],
    ] as const;
    for (const [kind, revision, markdown, ...metadata] of rows)
      database.run(
        "INSERT INTO task_documents (task_id, kind, revision, markdown, format, verdict, source_tool, updated_by, updated_at_ms) VALUES ('legacy', ?, ?, CAST(? AS TEXT), ?, ?, ?, ?, ?)",
        [kind, revision, Buffer.from(markdown, "utf8"), ...metadata],
      );
    // Migration 0009 stores each workflow artifact under its workflow code.
    const codeOf = (kind: string) =>
      ({ implementation_plan: "plan", qa_report: "qaReport" })[kind] ?? kind;
    const migratedRows = rows.map(([kind, ...fields]) => [codeOf(kind), ...fields]);
    const markdownBytes = rows.map(([kind, revision, markdown]) => [
      kind,
      revision,
      Buffer.from(markdown, "utf8").toString("hex").toUpperCase(),
    ]);
    expect(
      database
        .query(
          "SELECT kind, revision, hex(CAST(markdown AS BLOB)) FROM task_documents ORDER BY rowid",
        )
        .values(),
    ).toEqual(markdownBytes);
    const before = database.query(`SELECT ${KEPT_TASK_COLUMNS} FROM tasks`).all();
    database.close();

    const artifacts = await Effect.runPromise(store.listArtifacts({ repoPath, taskId: "legacy" }));
    expect(artifacts).toHaveLength(3);
    expect(
      artifacts.find((artifact) => artifact.artifactId === "workflow:legacy:qaReport"),
    ).toMatchObject({ revision: 5, verdict: "approved" });
    const migrated = new Database(databasePath, { readonly: true });
    try {
      expect<unknown>(
        migrated
          .query(
            "SELECT code, revision, markdown, format, verdict, source_tool, updated_by, updated_at_ms FROM tasks_artifacts ORDER BY rowid",
          )
          .values(),
      ).toEqual(migratedRows);
      expect(
        migrated
          .query(
            "SELECT code, revision, hex(CAST(markdown AS BLOB)) FROM tasks_artifacts ORDER BY rowid",
          )
          .values(),
      ).toEqual(markdownBytes.map(([kind, ...fields]) => [codeOf(String(kind)), ...fields]));
      expect(migrated.query(`SELECT ${KEPT_TASK_COLUMNS} FROM tasks`).all()).toEqual(before);
    } finally {
      migrated.close();
    }
    expect(readTableNames(databasePath)).not.toContain("task_documents");
    expect(readDrizzleMigrationRows(databasePath)).toHaveLength(10);
    expect(
      await Effect.runPromise(
        store.readArtifact({ repoPath, taskId: "legacy", artifactId: "workflow:legacy:spec" }),
      ),
    ).toMatchObject({ content: Buffer.from("\ufeff# Current\r\n  ") });
  });

  test("adds unique task-local codes without changing existing artifact bytes, history or provenance", async () => {
    const { databasePath, repoPath, store } = await createHarness();
    await createLegacyStore(databasePath, 8);
    for (const taskId of ["legacy-a", "legacy-b"]) insertLegacyTask({ databasePath, taskId });
    const columns =
      "artifact_id, task_id, classification, workflow_kind, revision, name, markdown, format, verdict, source_tool, updated_by, updated_at_ms, content, file_name, media_type, byte_size";
    const rows: SqliteValue[][] = [
      [
        "free-z",
        "legacy-a",
        "free",
        null,
        3,
        "Duplicate name",
        null,
        null,
        null,
        null,
        null,
        1730000000030,
        Buffer.from([0, 255, 13, 10]),
        "original.bin",
        "application/octet-stream",
        4,
      ],
      [
        "workflow:legacy-a:spec",
        "legacy-a",
        "workflow",
        "spec",
        -1,
        "Specification",
        "  \ufeff# Original\r\n",
        "plain_text",
        null,
        "old-tool",
        "old-agent",
        null,
        null,
        null,
        null,
        null,
      ],
      [
        "free-a",
        "legacy-a",
        "free",
        null,
        1,
        "Duplicate name",
        null,
        null,
        null,
        null,
        null,
        1730000000010,
        Buffer.alloc(0),
        "empty.txt",
        "text/plain",
        0,
      ],
      [
        "workflow:legacy-a:spec",
        "legacy-a",
        "workflow",
        "spec",
        4,
        "Specification",
        "\ufeff# Current\r\n  ",
        "plain_text",
        null,
        "odt_set_spec",
        "spec-agent",
        1730000000020,
        null,
        null,
        null,
        null,
      ],
      [
        "free-b",
        "legacy-b",
        "free",
        null,
        2,
        "Duplicate name",
        null,
        null,
        null,
        null,
        null,
        1730000000040,
        Buffer.from([239, 187, 191, 255]),
        "invalid.txt",
        "text/plain",
        4,
      ],
    ];
    const database = openFixtureDatabase(databasePath);
    for (const row of rows)
      database.run(
        `INSERT INTO tasks_artifacts (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row,
      );
    const keptColumns = columns.replace("workflow_kind, ", "");
    const beforeArtifacts = database
      .query(`SELECT ${keptColumns} FROM tasks_artifacts ORDER BY rowid`)
      .all();
    const beforeTasks = database.query(`SELECT ${KEPT_TASK_COLUMNS} FROM tasks ORDER BY id`).all();
    database.close();

    const artifacts = await Effect.runPromise(
      store.listArtifacts({ repoPath, taskId: "legacy-a" }),
    );
    expect(artifacts).toHaveLength(3);
    expect(artifacts.find((artifact) => artifact.artifactId === "free-a")).toMatchObject({
      code: "artifact-1",
    });
    expect(artifacts.find((artifact) => artifact.artifactId === "free-z")).toMatchObject({
      code: "artifact-2",
    });
    const migrated = new Database(databasePath, { readonly: true });
    try {
      expect(
        migrated.query(`SELECT ${keptColumns} FROM tasks_artifacts ORDER BY rowid`).all(),
      ).toEqual(beforeArtifacts);
      expect(migrated.query(`SELECT ${KEPT_TASK_COLUMNS} FROM tasks ORDER BY id`).all()).toEqual(
        beforeTasks,
      );
      expect(
        migrated.query("SELECT artifact_id, code FROM tasks_artifacts ORDER BY rowid").all(),
      ).toEqual([
        { artifact_id: "free-z", code: "artifact-2" },
        { artifact_id: "workflow:legacy-a:spec", code: "spec" },
        { artifact_id: "free-a", code: "artifact-1" },
        { artifact_id: "workflow:legacy-a:spec", code: "spec" },
        { artifact_id: "free-b", code: "artifact-1" },
      ]);
    } finally {
      migrated.close();
    }
    expect(readDrizzleMigrationRows(databasePath)).toHaveLength(10);
  });

  test("rolls back a failed copy and keeps the old table and migration ledger", async () => {
    const { databasePath, repoPath, store } = await createHarness();
    await createLegacyStore(databasePath);
    insertLegacyTask({ databasePath, taskId: "legacy" });
    const database = openFixtureDatabase(databasePath);
    database.exec("PRAGMA ignore_check_constraints = ON");
    database.run(
      "INSERT INTO task_documents (task_id, kind, revision, markdown, format) VALUES ('legacy', 'spec', 1, 'preserve me', 'invalid')",
    );
    database.close();

    const health = await Effect.runPromise(store.diagnoseRepoStore({ repoPath }));
    expect(health).toMatchObject({ isReady: false, status: "blocking" });
    expect(health.detail).toContain("Resolve the database error before retrying");
    expect(readTableNames(databasePath)).toContain("task_documents");
    expect(readTableNames(databasePath)).not.toContain("tasks_artifacts");
    expect(readDrizzleMigrationRows(databasePath)).toHaveLength(7);
    const retained = new Database(databasePath, { readonly: true });
    try {
      expect(retained.query("SELECT markdown FROM task_documents").get()).toEqual({
        markdown: "preserve me",
      });
    } finally {
      retained.close();
    }
  });

  test("rolls back a failed code migration without changing pre-code rows or the migration ledger", async () => {
    const { databasePath, repoPath, store } = await createHarness();
    await createLegacyStore(databasePath, 8);
    insertLegacyTask({ databasePath, taskId: "legacy" });
    const database = openFixtureDatabase(databasePath);
    database.exec("PRAGMA ignore_check_constraints = ON");
    database.run(
      "INSERT INTO tasks_artifacts (artifact_id, task_id, classification, revision, name, updated_at_ms, content, file_name, media_type, byte_size) VALUES ('free-invalid', 'legacy', 'free', 1, 'Preserve me', 1730000000010, ?, 'original.bin', 'application/octet-stream', 3)",
      [Buffer.from([0, 255])],
    );
    const before = database.query("SELECT * FROM tasks_artifacts").all();
    database.close();

    const health = await Effect.runPromise(store.diagnoseRepoStore({ repoPath }));
    expect(health).toMatchObject({ isReady: false, status: "blocking" });
    expect(health.detail).toContain("chk_tasks_artifacts_variant");
    expect(readTableNames(databasePath)).toContain("tasks_artifacts");
    expect(readTableNames(databasePath)).not.toContain("__new_tasks_artifacts");
    expect(readDrizzleMigrationRows(databasePath)).toHaveLength(8);
    const retained = new Database(databasePath, { readonly: true });
    try {
      expect(retained.query("SELECT * FROM tasks_artifacts").all()).toEqual(before);
    } finally {
      retained.close();
    }
  });
});

describe("task artifact repository", () => {
  test("uses indexed workflow history lookups for cards, metadata, and new revisions", async () => {
    const harness = await createTaskHarness();
    const { store, scope, databasePath } = harness;
    await Effect.runPromise(
      store.saveWorkflowArtifact({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        markdown: "# Spec",
        code: "spec",
      }),
    );
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* openSqliteDrizzleConnection({
            databasePath,
            configureWal: false,
            config: {
              schema: taskStoreSchema,
              logger: {
                logQuery(sql, params) {
                  queries.push({ sql, params });
                },
              },
            },
          });
          const observedStore = createSqliteTaskRepository({
            contextProvider: (repoPath, operation, use) =>
              harness.contextProvider(repoPath, operation, (context) =>
                use({ ...context, session: connection.session }),
              ),
          });
          yield* observedStore.getTask(scope);
          yield* observedStore.getTaskMetadata(scope);
          yield* observedStore.saveWorkflowArtifact({
            sourceTool: "workflow_artifact_save",
            updatedBy: "user",
            ...scope,
            markdown: "# Next spec",
            code: "spec",
          });
        }),
      ),
    );
    const database = new Database(databasePath, { readonly: true });
    try {
      const historyQueries = queries.filter(
        ({ sql }) => sql.startsWith("select ") && sql.includes('from "tasks_artifacts"'),
      );
      expect(historyQueries.length).toBeGreaterThan(0);
      for (const { sql, params } of historyQueries) {
        const plan = database
          .query<{ parent: number; detail: string }, SqliteValue[]>(`EXPLAIN QUERY PLAN ${sql}`)
          .all(...params.map((param) => sqliteValueSchema.parse(param)));
        const searches = plan.filter(({ detail }) => detail.startsWith("SEARCH "));
        expect(
          searches.some(({ detail }) => detail.includes("idx_tasks_artifacts_workflow_revision")),
        ).toBe(true);
        for (const { detail } of searches.filter(({ parent }) => parent !== 0)) {
          expect(detail).toContain("idx_tasks_artifacts_workflow_revision");
        }
        expect(plan.some(({ detail }) => detail.includes("TEMP B-TREE"))).toBe(false);
      }
    } finally {
      database.close();
    }
  });

  test("versions identify captured metadata and bytes across workflow recreation", async () => {
    const harness = await createSqliteTaskStoreHarness({
      now: () => new Date("2026-10-22T10:00:00.000Z"),
    });
    cleanups.add(harness.cleanup);
    const { store, repoPath } = harness;
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        status: "open",
        task: { title: "Versioned output", issueType: "task", priority: 2 },
      }),
    );
    const scope = { repoPath, taskId: task.id };
    const reference = { ...scope, artifactId: workflowArtifactId(task.id, "spec") };
    await Effect.runPromise(
      store.saveWorkflowArtifact({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        markdown: "# First",
        code: "spec",
      }),
    );
    const first = await Effect.runPromise(store.readArtifact(reference));
    expect(first?.version).toMatch(/^[a-f0-9]{64}$/);
    expect((await Effect.runPromise(store.readArtifact(reference)))?.version).toBe(first?.version);
    await Effect.runPromise(store.clearTaskArtifacts(scope));
    await Effect.runPromise(
      store.saveWorkflowArtifact({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        markdown: "# Other",
        code: "spec",
      }),
    );
    const changed = await Effect.runPromise(store.readArtifact(reference));
    expect(changed?.artifact).toEqual(first?.artifact);
    expect(changed?.version).not.toBe(first?.version);
    await Effect.runPromise(store.clearTaskArtifacts(scope));
    await Effect.runPromise(
      store.saveWorkflowArtifact({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        markdown: "# First",
        code: "spec",
      }),
    );
    expect((await Effect.runPromise(store.readArtifact(reference)))?.version).toBe(first?.version);

    const free = await Effect.runPromise(store.createArtifact({ ...scope, ...file }));
    const freeReference = { ...scope, artifactId: free.artifactId };
    const beforeRename = await Effect.runPromise(store.readArtifact(freeReference));
    await Effect.runPromise(store.renameArtifact({ ...freeReference, name: "Changed name" }));
    const afterRename = await Effect.runPromise(store.readArtifact(freeReference));
    expect(afterRename?.content).toEqual(beforeRename?.content);
    expect(afterRename?.version).not.toBe(beforeRename?.version);
  });

  test("enforces exclusive row variants, byte sizes, and one current free revision", async () => {
    const { store, scope, databasePath } = await createTaskHarness();
    const artifact = await Effect.runPromise(store.createArtifact({ ...scope, ...file }));
    const other = await Effect.runPromise(
      store.createArtifact({ ...scope, ...file, name: "Other output" }),
    );
    await Effect.runPromise(
      store.saveWorkflowArtifact({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        markdown: "# Workflow",
        code: "spec",
      }),
    );
    const database = openFixtureDatabase(databasePath);
    try {
      expect(() =>
        database.run("UPDATE tasks_artifacts SET code = NULL WHERE artifact_id = ?", [
          artifact.artifactId,
        ]),
      ).toThrow("NOT NULL constraint failed");
      for (const assignment of [
        "markdown = '# Cannot become workflow content'",
        "byte_size = 999",
        "content = NULL",
        "updated_at_ms = NULL",
        "classification = 'other'",
        "code = ''",
        "code = 'Uppercase'",
        "code = '1numeric'",
        "code = 'bad_code'",
        "code = 'bad--code'",
        "code = 'bad-'",
        "code = 'qaReport'",
        `code = '${"a".repeat(129)}'`,
      ]) {
        expect(() =>
          database.run(`UPDATE tasks_artifacts SET ${assignment} WHERE artifact_id = ?`, [
            artifact.artifactId,
          ]),
        ).toThrow("chk_tasks_artifacts_variant");
      }
      expect(() =>
        database.run(
          "INSERT INTO tasks_artifacts (artifact_id, task_id, classification, revision, name, code, updated_at_ms, content, file_name, media_type, byte_size) SELECT artifact_id, task_id, classification, revision + 1, name, code, updated_at_ms, content, file_name, media_type, byte_size FROM tasks_artifacts WHERE artifact_id = ?",
          [artifact.artifactId],
        ),
      ).toThrow("UNIQUE constraint failed");
      expect(() =>
        database.run("UPDATE tasks_artifacts SET code = 'specification' WHERE artifact_id = ?", [
          other.artifactId,
        ]),
      ).toThrow("UNIQUE constraint failed");
      expect(() =>
        database.run("UPDATE tasks_artifacts SET code = 'workflow-code' WHERE artifact_id = ?", [
          workflowArtifactId(scope.taskId, "spec"),
        ]),
      ).toThrow("chk_tasks_artifacts_variant");
    } finally {
      database.close();
    }
    expect(
      await Effect.runPromise(store.readArtifact({ ...scope, artifactId: artifact.artifactId })),
    ).toMatchObject({ artifact, content: Buffer.from(file.content) });
  });

  test("keeps free identities and exact bytes while workflow names and duplicate names remain free", async () => {
    const { store, scope, task } = await createTaskHarness();
    const first = await Effect.runPromise(store.createArtifact({ ...scope, ...file }));
    const second = await Effect.runPromise(store.createArtifact({ ...scope, ...file }));
    expect(first.artifactId).not.toBe(second.artifactId);
    expect(first).toMatchObject({
      classification: "free",
      code: "specification",
      revision: 1,
      byteSize: 5,
    });
    expect(second).toMatchObject({ code: "specification-2" });
    expect(
      await Effect.runPromise(store.readArtifact({ ...scope, artifactId: first.artifactId })),
    ).toMatchObject({ artifact: first, content: Buffer.from(file.content) });
    const renamed = await Effect.runPromise(
      store.renameArtifact({ ...scope, artifactId: first.artifactId, name: "Renamed" }),
    );
    const replaced = await Effect.runPromise(
      store.replaceArtifact({
        ...scope,
        artifactId: first.artifactId,
        fileName: "empty.txt",
        mediaType: "text/plain",
        content: new Uint8Array(),
      }),
    );
    expect(renamed).toMatchObject({
      artifactId: first.artifactId,
      code: "specification",
      revision: 2,
      name: "Renamed",
    });
    expect(replaced).toMatchObject({
      artifactId: first.artifactId,
      code: "specification",
      revision: 3,
      name: "Renamed",
      byteSize: 0,
      fileName: "empty.txt",
      mediaType: "text/plain",
    });
    expect(
      await Effect.runPromise(store.readArtifact({ ...scope, artifactId: first.artifactId })),
    ).toMatchObject({ artifact: replaced, content: Buffer.alloc(0) });
    expect(await Effect.runPromise(store.getTask(scope))).toEqual(task);
    expect(await Effect.runPromise(store.listArtifacts(scope))).toHaveLength(2);
  });

  test("assigns task-local stable codes and rejects explicit invalid or occupied codes atomically", async () => {
    const { store, scope, databasePath } = await createTaskHarness();
    for (const [name, code, expectedCode] of [
      ["Build output", undefined, "build-output"],
      ["Build output", undefined, "build-output-2"],
      ["Build output", undefined, "build-output-3"],
      ["! Build___output !", undefined, "build-output-4"],
      ["42 build logs", undefined, "artifact-42-build-logs"],
      ["spec", undefined, "artifact-spec"],
      ["plan", undefined, "artifact-plan"],
      ["東京", undefined, "artifact"],
      ["!!!", undefined, "artifact-2"],
      ["Custom output", "release-results-v1", "release-results-v1"],
      ["Maximum explicit code", "a".repeat(128), "a".repeat(128)],
      ["z".repeat(200), undefined, "z".repeat(128)],
      ["z".repeat(200), undefined, `${"z".repeat(126)}-2`],
    ] as const) {
      const artifact = await Effect.runPromise(
        store.createArtifact({ ...scope, ...file, name, code }),
      );
      expect(artifact).toMatchObject({ classification: "free", name, code: expectedCode });
    }
    const other = await Effect.runPromise(
      store.createTask({
        repoPath: scope.repoPath,
        status: "open",
        task: { title: "Other task", issueType: "task", priority: 2 },
      }),
    );
    expect(
      await Effect.runPromise(
        store.createArtifact({ ...scope, ...file, taskId: other.id, code: "build-output" }),
      ),
    ).toMatchObject({ code: "build-output" });

    const database = new Database(databasePath, { readonly: true });
    try {
      const before = database.query("SELECT * FROM tasks_artifacts ORDER BY rowid").all();
      for (const code of [
        "build-output",
        "spec",
        "plan",
        "qaReport",
        "",
        "Uppercase",
        "1numeric",
        "bad_code",
        "bad--code",
        "bad-",
        "a".repeat(129),
      ]) {
        expect(
          await Effect.runPromise(
            Effect.flip(store.createArtifact({ ...scope, ...file, name: "Rejected output", code })),
          ),
        ).toMatchObject({ _tag: "HostValidationError", field: "code" });
        expect(database.query("SELECT * FROM tasks_artifacts ORDER BY rowid").all()).toEqual(
          before,
        );
      }
    } finally {
      database.close();
    }
  });

  test("retains the committed name and bytes after rejected replacements, and accepts exactly 10 MiB", async () => {
    const { store, scope, databasePath } = await createTaskHarness();
    const artifact = await Effect.runPromise(
      store.createArtifact({
        ...scope,
        ...file,
        content: new Uint8Array(TASK_ARTIFACT_MAX_FILE_BYTES),
      }),
    );
    expect(artifact).toMatchObject({ byteSize: TASK_ARTIFACT_MAX_FILE_BYTES });
    await expect(
      Effect.runPromise(
        store.replaceArtifact({
          ...scope,
          artifactId: artifact.artifactId,
          ...file,
          name: "Rejected oversized replacement",
          content: new Uint8Array(TASK_ARTIFACT_MAX_FILE_BYTES + 1),
        }),
      ),
    ).rejects.toThrow("at most 10 MiB");
    await expect(
      Effect.runPromise(
        store.createArtifact({
          ...scope,
          ...file,
          content: new Uint8Array(TASK_ARTIFACT_MAX_FILE_BYTES + 1),
        }),
      ),
    ).rejects.toThrow("at most 10 MiB");
    const database = openFixtureDatabase(databasePath);
    database.exec(
      "CREATE TRIGGER reject_artifact_update BEFORE UPDATE ON tasks_artifacts BEGIN SELECT RAISE(ABORT, 'forced write failure'); END",
    );
    database.close();
    await expect(
      Effect.runPromise(
        store.replaceArtifact({
          ...scope,
          artifactId: artifact.artifactId,
          ...file,
          name: "Rejected replacement",
        }),
      ),
    ).rejects.toThrow("forced write failure");
    const current = await Effect.runPromise(
      store.readArtifact({ ...scope, artifactId: artifact.artifactId }),
    );
    expect(current?.artifact).toEqual(artifact);
    expect(current?.content).toEqual(Buffer.alloc(TASK_ARTIFACT_MAX_FILE_BYTES));
    expect(await Effect.runPromise(store.listArtifacts(scope))).toHaveLength(1);
  });

  test("rejects workflow and other-task mutations, and keeps closed task artifacts readable", async () => {
    const { store, scope } = await createTaskHarness();
    const free = await Effect.runPromise(store.createArtifact({ ...scope, ...file }));
    await Effect.runPromise(
      store.saveWorkflowArtifact({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        markdown: "# Spec",
        code: "spec",
      }),
    );
    const workflowId = workflowArtifactId(scope.taskId, "spec");
    for (const mutate of [
      store.renameArtifact({ ...scope, artifactId: workflowId, name: "No" }),
      store.replaceArtifact({ ...scope, artifactId: workflowId, ...file }),
      store.deleteArtifact({ ...scope, artifactId: workflowId }),
    ])
      await expect(Effect.runPromise<unknown, unknown>(mutate)).rejects.toThrow("workflow control");
    const other = await Effect.runPromise(
      store.createTask({
        repoPath: scope.repoPath,
        status: "open",
        task: { title: "Other", issueType: "task", priority: 2 },
      }),
    );
    const otherScope = { ...scope, taskId: other.id, artifactId: free.artifactId };
    expect(await Effect.runPromise(store.readArtifact(otherScope))).toBeNull();
    await expect(
      Effect.runPromise(store.renameArtifact({ ...otherScope, name: "No" })),
    ).rejects.toThrow("Artifact not found");
    await expect(Effect.runPromise(store.deleteArtifact(otherScope))).rejects.toThrow(
      "Artifact not found",
    );
    await expect(
      Effect.runPromise(store.replaceArtifact({ ...otherScope, ...file })),
    ).rejects.toThrow("Artifact not found");
    await Effect.runPromise(store.transitionTask({ ...scope, status: "closed" }));
    for (const mutate of [
      store.createArtifact({ ...scope, ...file }),
      store.renameArtifact({ ...scope, artifactId: free.artifactId, name: "No" }),
      store.replaceArtifact({ ...scope, artifactId: free.artifactId, ...file }),
      store.deleteArtifact({ ...scope, artifactId: free.artifactId }),
    ])
      await expect(Effect.runPromise<unknown, unknown>(mutate)).rejects.toThrow(
        "Tasks in a terminal state are read-only",
      );
    expect(await Effect.runPromise(store.listArtifacts(scope))).toHaveLength(2);
    expect(
      (await Effect.runPromise(store.readArtifact({ ...scope, artifactId: free.artifactId })))
        ?.content,
    ).toEqual(Buffer.from(file.content));
    await Effect.runPromise(
      store.saveWorkflowArtifact({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        markdown: "# Manual edit",
        code: "spec",
      }),
    );
    expect((await Effect.runPromise(store.getTask(scope))).status).toBe("closed");
  });

  test("clears only QA on implementation reset, all artifacts on task reset, and cascades task deletion", async () => {
    const { store, scope, databasePath } = await createTaskHarness();
    await Effect.runPromise(
      store.saveWorkflowArtifact({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        markdown: "# Spec",
        code: "spec",
      }),
    );
    await Effect.runPromise(
      store.saveWorkflowArtifact({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...scope,
        markdown: "# Plan",
        code: "plan",
      }),
    );
    for (const verdict of ["rejected", "approved"] as const)
      await Effect.runPromise(
        store.saveWorkflowArtifact({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...scope,
          status: "human_review",
          markdown: `# ${verdict}`,
          verdict,
          code: "qaReport",
        }),
      );
    const free = await Effect.runPromise(store.createArtifact({ ...scope, ...file }));
    expect(await Effect.runPromise(store.listArtifacts(scope))).toHaveLength(4);
    await Effect.runPromise(store.clearWorkflowArtifacts({ ...scope, codes: ["qaReport"] }));
    expect(
      (await Effect.runPromise(store.listArtifacts(scope)))
        .map((artifact) => artifact.artifactId)
        .sort(),
    ).toEqual(
      [
        free.artifactId,
        workflowArtifactId(scope.taskId, "spec"),
        workflowArtifactId(scope.taskId, "plan"),
      ].sort(),
    );
    await Effect.runPromise(store.clearTaskArtifacts(scope));
    expect(await Effect.runPromise(store.listArtifacts(scope))).toEqual([]);
    await Effect.runPromise(store.createArtifact({ ...scope, ...file }));
    await Effect.runPromise(store.deleteTask({ ...scope }));
    const database = new Database(databasePath, { readonly: true });
    try {
      expect(database.query("SELECT count(*) as count FROM tasks_artifacts").get()).toEqual({
        count: 0,
      });
    } finally {
      database.close();
    }
  });
});
