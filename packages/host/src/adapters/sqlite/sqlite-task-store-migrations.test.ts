import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  createLegacyTaskStore,
  createSqliteTaskStoreHarness,
  insertLegacyTask,
  readTaskColumnNullability,
  readWorkflowArtifactCount,
} from "./sqlite-task-store-test-support";

const cleanups = new Set<() => Promise<void>>();
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

describe("generic task workflow migration", () => {
  test("stores each legacy workflow artifact by its workflow code", async () => {
    const harness = await createSqliteTaskStoreHarness();
    cleanups.add(harness.cleanup);
    const { databasePath, repoPath, store } = harness;
    await createLegacyTaskStore(databasePath, 9);
    insertLegacyTask({ databasePath, taskId: "task-1", status: "human_review" });
    insertLegacyWorkflowArtifact(databasePath, "task-1", "spec");
    insertLegacyWorkflowArtifact(databasePath, "task-1", "implementation_plan");
    insertLegacyWorkflowArtifact(databasePath, "task-1", "qa_report", "approved");

    const [task] = await Effect.runPromise(store.listTasks({ repoPath }));

    expect(readWorkflowArtifactRows(databasePath)).toEqual([
      { artifact_id: "workflow:task-1:plan", code: "plan", verdict: null },
      { artifact_id: "workflow:task-1:qaReport", code: "qaReport", verdict: "approved" },
      { artifact_id: "workflow:task-1:spec", code: "spec", verdict: null },
    ]);
    expect(task?.artifactSummary).toMatchObject({
      spec: { present: true },
      plan: { present: true },
      qaReport: { present: true, verdict: "approved" },
    });
  });
});

describe("tasks table migration without hierarchy and QA columns", () => {
  test("keeps tasks and their artifacts, and turns epics into features", async () => {
    const harness = await createSqliteTaskStoreHarness();
    cleanups.add(harness.cleanup);
    const { databasePath, repoPath, store } = harness;
    await createLegacyTaskStore(databasePath, 9);
    insertLegacyTask({ databasePath, taskId: "epic-1", issueType: "epic" });
    insertLegacyTask({ databasePath, taskId: "child-1", parentId: "epic-1", status: "spec_ready" });
    insertLegacyTask({ databasePath, taskId: "task-2", qaRequired: 0, status: "in_progress" });
    insertLegacySpec(databasePath, "child-1");

    const tasks = await Effect.runPromise(store.listTasks({ repoPath }));

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
    expect(readWorkflowArtifactCount(databasePath, "child-1", "spec")).toBe(1);
    expect(readTaskColumnNullability(databasePath, "parent_id")).toBeUndefined();
    expect(readTaskColumnNullability(databasePath, "qa_required")).toBeUndefined();
  });

  test("turns foreign keys back on after the migration", async () => {
    const harness = await createSqliteTaskStoreHarness();
    cleanups.add(harness.cleanup);
    const { databasePath, repoPath, store } = harness;
    await createLegacyTaskStore(databasePath, 9);
    insertLegacyTask({ databasePath, taskId: "task-1" });
    insertLegacySpec(databasePath, "task-1");

    await Effect.runPromise(store.deleteTask({ repoPath, taskId: "task-1" }));

    expect(readWorkflowArtifactCount(databasePath, "task-1", "spec")).toBe(0);
  });
});
