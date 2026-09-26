import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createSqliteIssueImportStore } from "./sqlite-issue-import-store";
import { createSqliteTaskStoreHarness } from "./sqlite-task-store-test-support";

const cleanups = new Set<() => Promise<void>>();
afterEach(async () => {
  await Promise.all([...cleanups].map((cleanup) => cleanup()));
  cleanups.clear();
});

const sourceIssue = {
  providerId: "github",
  scope: "github.com/example/repo",
  sourceId: "42",
  number: "42",
  url: "https://github.com/example/repo/issues/42",
};

describe("SQLite Issue imports", () => {
  test("creates a Task with its source reference in one write and prevents a duplicate", async () => {
    const harness = await createSqliteTaskStoreHarness();
    cleanups.add(harness.cleanup);
    const store = createSqliteIssueImportStore({ contextProvider: harness.contextProvider });
    const input = {
      repoPath: harness.repoPath,
      sourceIssue,
      task: {
        title: "Issue title",
        description: "Issue body",
        issueType: "task" as const,
        priority: 2,
        labels: ["bug"],
        aiReviewEnabled: true,
      },
    };

    const first = await Effect.runPromise(store.createImportedTask(input));
    expect(first.outcome).toBe("created");
    if (first.outcome !== "created") throw new Error("Expected an imported Task.");
    expect(first.task).toMatchObject({
      title: "Issue title",
      description: "Issue body",
      status: "open",
      sourceIssue,
      labels: ["bug"],
      aiReviewEnabled: true,
    });
    expect(
      await Effect.runPromise(
        store.getSourceIssue({ repoPath: harness.repoPath, taskId: first.task.id }),
      ),
    ).toEqual(sourceIssue);
    expect(
      await Effect.runPromise(
        store.getSourceIssue({ repoPath: harness.repoPath, taskId: "missing" }),
      ),
    ).toBeUndefined();
    expect(
      await Effect.runPromise(
        store.findLinkedTaskIds({
          repoPath: harness.repoPath,
          providerId: sourceIssue.providerId,
          scope: sourceIssue.scope,
          sourceIds: [sourceIssue.sourceId],
        }),
      ),
    ).toEqual({ 42: first.task.id });

    const duplicate = await Effect.runPromise(store.createImportedTask(input));
    expect(duplicate).toEqual({ outcome: "duplicate", taskId: first.task.id });
    expect(
      (await Effect.runPromise(harness.store.listTasks({ repoPath: harness.repoPath }))).map(
        (task) => task.id,
      ),
    ).toEqual([first.task.id]);

    const edited = await Effect.runPromise(
      harness.store.updateTask({
        repoPath: harness.repoPath,
        taskId: first.task.id,
        patch: { title: "Local title" },
      }),
    );
    expect(edited.sourceIssue).toEqual(sourceIssue);
  });

  test("keeps old Task rows readable after the migration", async () => {
    const database = new Database(":memory:");
    try {
      for (const name of [
        "0000_create_task_store_tables.sql",
        "0001_soft_mauler.sql",
        "0002_workspace_sessions.sql",
        "0003_workspace_session_drafts.sql",
      ])
        database.exec(await Bun.file(new URL(`./drizzle/${name}`, import.meta.url)).text());
      database.exec(
        "INSERT INTO tasks (id,title,description,status,issue_type,priority,parent_id,qa_required,labels_json,agent_sessions_json,target_branch_json,pull_request_json,direct_merge_json,created_at_ms,updated_at_ms) VALUES ('old','Old',NULL,'open','task',2,NULL,1,'[]','[]',NULL,NULL,NULL,1,1)",
      );
      database.exec(
        await Bun.file(new URL("./drizzle/0004_puzzling_bedlam.sql", import.meta.url)).text(),
      );
      expect(
        database
          .query(
            "SELECT id, source_provider_id, source_scope, source_id, source_number, source_url FROM tasks WHERE id='old'",
          )
          .get(),
      ).toEqual({
        id: "old",
        source_provider_id: null,
        source_scope: null,
        source_id: null,
        source_number: null,
        source_url: null,
      });
    } finally {
      database.close();
    }
  });
});
