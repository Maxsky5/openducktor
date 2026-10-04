import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { createSqliteWorkspaceSessionStore } from "./sqlite-workspace-session-store";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "./sqlite-task-store-test-support";

let harness: SqliteTaskStoreTestHarness;
beforeEach(async () => {
  harness = await createSqliteTaskStoreHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

test("the activity migration keeps old workspace records and leaves their activity unset", async () => {
  const database = new Database(":memory:");
  try {
    for (const migration of ["0002_workspace_sessions.sql", "0003_workspace_session_drafts.sql"]) {
      database.exec(await Bun.file(new URL(`./drizzle/${migration}`, import.meta.url)).text());
    }
    database.exec(
      "INSERT INTO workspace_sessions VALUES ('old', 'claude', 'native', '{}', NULL, NULL, 'Title', NULL, 10, 100, NULL)",
    );
    const before = database.query("SELECT * FROM workspace_sessions").get();
    const indexes = database
      .query("SELECT name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all();
    database.exec(
      await Bun.file(new URL("./drizzle/0005_session_activity.sql", import.meta.url)).text(),
    );
    expect(database.prepare("SELECT * FROM workspace_sessions").get()).toEqual({
      ...before!,
      last_activity_at_ms: null,
    });
    expect(
      database
        .query("SELECT name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name")
        .all(),
    ).toEqual(indexes);
    database.exec("UPDATE workspace_sessions SET last_activity_at_ms = 30 WHERE id = 'old'");
    expect(
      database
        .query("SELECT created_at_ms, updated_at_ms, last_activity_at_ms FROM workspace_sessions")
        .get(),
    ).toEqual({ created_at_ms: 10, updated_at_ms: 100, last_activity_at_ms: 30 });
  } finally {
    database.close();
  }
});

test("task activity survives stale upserts and does not edit the task", async () => {
  const repoPath = harness.repoPath;
  const task = await Effect.runPromise(
    harness.store.createTask({
      repoPath,
      task: { title: "Activity", issueType: "task", priority: 2, aiReviewEnabled: false },
    }),
  );
  const session = createAgentSessionRecord({
    externalSessionId: "activity",
    runtimeKind: "claude",
  });
  await Effect.runPromise(harness.store.upsertAgentSession({ repoPath, taskId: task.id, session }));
  const before = await Effect.runPromise(harness.store.getTask({ repoPath, taskId: task.id }));
  const occurredAt = Date.parse(session.startedAt) + 60_000;
  const input = { repoPath, identity: session, occurredAt };
  expect(await Effect.runPromise(harness.store.recordAgentSessionActivity(input))).toEqual({
    taskId: task.id,
    agentSessions: [{ ...session, lastActivityAt: occurredAt }],
  });
  expect(
    await Effect.runPromise(
      harness.store.recordAgentSessionActivity({ ...input, occurredAt: occurredAt - 1 }),
    ),
  ).toBeNull();
  expect(
    await Effect.runPromise(
      harness.store.recordAgentSessionActivity({
        ...input,
        identity: { ...session, workingDirectory: "/another" },
      }),
    ),
  ).toBeNull();
  const after = await Effect.runPromise(harness.store.getTask({ repoPath, taskId: task.id }));
  expect(after.updatedAt).toEqual(before.updatedAt);
  await Effect.runPromise(harness.store.upsertAgentSession({ repoPath, taskId: task.id, session }));
  const stored = await Effect.runPromise(
    harness.store.listAgentSessionsForTasks({ repoPath, taskIds: [task.id] }),
  );
  expect(stored[0]?.agentSessions[0]?.lastActivityAt).toBe(occurredAt);
  const database = new Database(harness.databasePath, { readonly: true });
  try {
    const row = database
      .query<{ activity: number }, [string]>(
        "select json_extract(agent_sessions_json, '$[0].lastActivityAt') as activity from tasks where id = ?",
      )
      .get(task.id);
    expect(row?.activity).toBe(occurredAt);
  } finally {
    database.close();
  }
});

test("workspace activity has its own saved time and keeps legacy records", async () => {
  const store = createSqliteWorkspaceSessionStore(harness.contextProvider);
  const scope = { repoPath: harness.repoPath, workspaceId: "fairnest" };
  const ref = { ...scope, sessionId: "activity" };
  const session = {
    id: ref.sessionId,
    runtimeKind: "claude" as const,
    externalSessionId: "workspace-activity",
    executionTarget: { kind: "local_repo_root" as const, workingDirectory: harness.repoPath },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: null,
    createdAt: 10,
    updatedAt: 100,
    archivedAt: null,
  };
  await Effect.runPromise(store.create({ ...scope, session }));
  expect((await Effect.runPromise(store.get(ref))).lastActivityAt).toBeUndefined();
  await Effect.runPromise(
    store.recordActivity({ ...ref, activity: { type: "session_activity", occurredAt: 30 } }),
  );
  await Effect.runPromise(
    store.recordActivity({ ...ref, activity: { type: "assistant_response", occurredAt: 20 } }),
  );
  await Effect.runPromise(store.rename({ ...ref, manualTitle: "Renamed" }));
  const saved = await Effect.runPromise(store.get(ref));
  expect(saved.lastActivityAt).toBe(30);
  expect(saved.updatedAt).toBe(100);
  const database = new Database(harness.databasePath, { readonly: true });
  try {
    expect(
      database
        .query<{ activity: number }, []>(
          "select last_activity_at_ms as activity from workspace_sessions",
        )
        .get()?.activity,
    ).toBe(30);
  } finally {
    database.close();
  }
});
