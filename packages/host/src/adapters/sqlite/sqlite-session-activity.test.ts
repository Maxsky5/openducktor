import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { replaceTaskSessions } from "./sqlite-task-relations";
import { asc, sql } from "drizzle-orm";
import { Effect } from "effect";
import {
  createAgentSessionRecord,
  expectFailureTag,
} from "../../ports/task-store-port-contract.test-support";
import { createSqliteWorkspaceSessionStore } from "./sqlite-workspace-session-store";
import { workspaces } from "./sqlite-host-settings-schema";
import { tasks, taskSessions } from "./sqlite-host-database-schema";
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
  const task = await Effect.runPromise(
    harness.store.createTask({
      ...harness.scope,
      status: "open",
      task: { title: "Activity", issueType: "task", priority: 2 },
    }),
  );
  const session = createAgentSessionRecord({
    externalSessionId: "activity",
    runtimeKind: "claude",
  });
  await Effect.runPromise(
    harness.store.upsertAgentSession({
      ownershipScope: { catalogRevision: 0, workspaces: [harness.scope] },
      ...harness.scope,
      taskId: task.id,
      session,
    }),
  );
  const before = await Effect.runPromise(
    harness.store.getTask({ ...harness.scope, taskId: task.id }),
  );
  const occurredAt = Date.parse(session.startedAt) + 60_000;
  const input = { ...harness.scope, identity: session, occurredAt };
  expect(await Effect.runPromise(harness.store.recordAgentSessionActivity(input))).toEqual({
    workspaceId: "fairnest",
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
  const after = await Effect.runPromise(
    harness.store.getTask({ ...harness.scope, taskId: task.id }),
  );
  expect(after.updatedAt).toEqual(before.updatedAt);
  await Effect.runPromise(
    harness.store.upsertAgentSession({
      ownershipScope: { catalogRevision: 0, workspaces: [harness.scope] },
      ...harness.scope,
      taskId: task.id,
      session,
    }),
  );
  const stored = await Effect.runPromise(
    harness.store.listAgentSessionsForTasks({ ...harness.scope, taskIds: [task.id] }),
  );
  expect(stored[0]?.agentSessions[0]?.lastActivityAt).toBe(occurredAt);
  const database = new Database(harness.databasePath, { readonly: true });
  try {
    const row = database
      .query<{ activity: number }, [string]>(
        "select last_activity_at_ms as activity from task_sessions where task_id = ?",
      )
      .get(task.id);
    expect(row?.activity).toBe(occurredAt);
  } finally {
    database.close();
  }
});

test("task activity changes only its stored row among 100 sessions and colliding owners", async () => {
  const task = await Effect.runPromise(
    harness.store.createTask({
      ...harness.scope,
      status: "open",
      task: { title: "Activity rows", issueType: "task", priority: 2 },
    }),
  );
  const sibling = await Effect.runPromise(
    harness.store.createTask({
      ...harness.scope,
      status: "open",
      task: { title: "Other owner", issueType: "task", priority: 2 },
    }),
  );
  const startedAt = Date.parse("2026-06-10T10:00:00.000Z");
  const records = Array.from({ length: 100 }, (_, position) =>
    createAgentSessionRecord({
      externalSessionId: `activity-${position}`,
      startedAt: new Date(startedAt + position * 1000).toISOString(),
    }),
  );
  const identity = records[37]!;
  records[80] = { ...identity, startedAt: records[80]!.startedAt };
  const otherWorkspaceId = "other-workspace";
  await Effect.runPromise(
    harness.withHostDatabase("test.seedActivityRows", (session) =>
      session.transaction("test.seedActivityRows", (transaction) =>
        Effect.gen(function* () {
          yield* transaction.execute(
            (database) =>
              database.insert(workspaces).values({
                workspaceId: otherWorkspaceId,
                workspaceName: "Other workspace",
                repoPath: "/repos/other",
                branchPrefix: "task",
                defaultTargetBranch: "main",
                closed: false,
              }),
            "test.seedOtherWorkspace",
          );
          yield* transaction.execute(
            (database) =>
              database.insert(tasks).values({
                workspaceId: otherWorkspaceId,
                id: task.id,
                title: "Same task ID",
                status: "open",
                issueType: "task",
                priority: 2,
                createdAt: new Date(startedAt),
                updatedAt: new Date(startedAt),
              }),
            "test.seedOtherTask",
          );
          yield* replaceTaskSessions(transaction, harness.workspaceId, task.id, records);
          yield* replaceTaskSessions(transaction, harness.workspaceId, sibling.id, [
            { ...identity, workingDirectory: "/repos/another-owner" },
          ]);
          yield* replaceTaskSessions(transaction, otherWorkspaceId, task.id, [identity]);
        }),
      ),
    ),
  );
  const snapshot = () =>
    Effect.runPromise(
      harness.withHostDatabase("test.activitySnapshot", (session) =>
        Effect.gen(function* () {
          const rows = yield* session.execute(
            (database) =>
              database
                .select()
                .from(taskSessions)
                .orderBy(
                  asc(taskSessions.workspaceId),
                  asc(taskSessions.taskId),
                  asc(taskSessions.position),
                ),
            "test.activityRows",
          );
          const taskRows = yield* session.execute(
            (database) =>
              database.select().from(tasks).orderBy(asc(tasks.workspaceId), asc(tasks.id)),
            "test.activityTasks",
          );
          const changes = yield* session.execute(
            (database) => database.values<[number]>(sql`select total_changes()`),
            "test.activityChanges",
          );
          return { rows, taskRows, changes: changes[0]![0] };
        }),
      ),
    );
  const before = await snapshot();
  const occurredAt = startedAt + 120_000;
  const input = {
    ...harness.scope,
    identity: { ...identity, workingDirectory: `${identity.workingDirectory}/` },
    occurredAt,
  };
  expect(await Effect.runPromise(harness.store.recordAgentSessionActivity(input))).toEqual({
    workspaceId: harness.workspaceId,
    taskId: task.id,
    agentSessions: records
      .toReversed()
      .map((record) =>
        record === records[80] ? { ...record, lastActivityAt: occurredAt } : record,
      ),
  });
  const after = await snapshot();
  expect(after.changes - before.changes).toBe(1);
  expect(after.rows).toEqual(
    before.rows.map((row) =>
      row.workspaceId === harness.workspaceId && row.taskId === task.id && row.position === 80
        ? { ...row, lastActivityAt: occurredAt }
        : row,
    ),
  );
  expect(after.taskRows).toEqual(before.taskRows);
  for (const time of [occurredAt, occurredAt - 1]) {
    expect(
      await Effect.runPromise(
        harness.store.recordAgentSessionActivity({ ...input, occurredAt: time }),
      ),
    ).toBeNull();
  }
  expect(await snapshot()).toEqual(after);
});

test.each([
  ["/repos/project", "/repos/project/"],
  [String.raw`C:\Repos\Project`, "c:/repos/project/"],
])("task activity matches saved path %s with event path %s", async (savedPath, eventPath) => {
  const task = await Effect.runPromise(
    harness.store.createTask({
      ...harness.scope,
      status: "open",
      task: { title: "Path activity", issueType: "task", priority: 2 },
    }),
  );
  const session = createAgentSessionRecord({ workingDirectory: savedPath });
  await Effect.runPromise(
    harness.store.upsertAgentSession({
      ownershipScope: { catalogRevision: 0, workspaces: [harness.scope] },
      ...harness.scope,
      taskId: task.id,
      session,
    }),
  );
  const occurredAt = Date.parse(session.startedAt) + 60_000;

  expect(
    await Effect.runPromise(
      harness.store.recordAgentSessionActivity({
        ...harness.scope,
        identity: { ...session, workingDirectory: eventPath },
        occurredAt,
      }),
    ),
  ).toEqual({
    workspaceId: "fairnest",
    taskId: task.id,
    agentSessions: [{ ...session, lastActivityAt: occurredAt }],
  });
  const saved = await Effect.runPromise(
    harness.store.listAgentSessionsForTasks({ ...harness.scope, taskIds: [task.id] }),
  );
  expect(saved[0]?.agentSessions[0]?.lastActivityAt).toBe(occurredAt);
});

test("task activity picks the full identity among tasks sharing a runtime session ID", async () => {
  const saved = [];
  for (const workingDirectory of ["/repos/other-one", "/repos/other-two", "/repos/owner"]) {
    const task = await Effect.runPromise(
      harness.store.createTask({
        ...harness.scope,
        status: "open",
        task: { title: workingDirectory, issueType: "task", priority: 2 },
      }),
    );
    const session = createAgentSessionRecord({ workingDirectory });
    await Effect.runPromise(
      harness.contextProvider(
        harness.scope,
        "test.seedLegacyOwner",
        ({ session: database, workspaceId }) =>
          replaceTaskSessions(database, workspaceId, task.id, [session]),
      ),
    );
    saved.push({ task, session });
  }
  const owner = saved[2]!;
  const occurredAt = Date.parse(owner.session.startedAt) + 60_000;

  expect(
    await Effect.runPromise(
      harness.store.recordAgentSessionActivity({
        ...harness.scope,
        identity: { ...owner.session, workingDirectory: "/repos/owner/" },
        occurredAt,
      }),
    ),
  ).toEqual({
    workspaceId: "fairnest",
    taskId: owner.task.id,
    agentSessions: [{ ...owner.session, lastActivityAt: occurredAt }],
  });
  const records = await Effect.runPromise(
    harness.store.listAgentSessionsForTasks({
      ...harness.scope,
      taskIds: saved.map(({ task }) => task.id),
    }),
  );
  expect(records.map((row) => row.agentSessions[0]?.lastActivityAt)).toEqual([
    undefined,
    undefined,
    occurredAt,
  ]);
});

test("task activity rejects duplicate owners after matching their paths", async () => {
  const taskIds = [];
  for (const workingDirectory of ["/repos/shared", "/repos/shared/"]) {
    const task = await Effect.runPromise(
      harness.store.createTask({
        ...harness.scope,
        status: "open",
        task: { title: workingDirectory, issueType: "task", priority: 2 },
      }),
    );
    const session = createAgentSessionRecord({ workingDirectory });
    await Effect.runPromise(
      harness.contextProvider(
        harness.scope,
        "test.seedLegacyOwner",
        ({ session: database, workspaceId }) =>
          replaceTaskSessions(database, workspaceId, task.id, [session]),
      ),
    );
    taskIds.push(task.id);
  }
  const session = createAgentSessionRecord({ workingDirectory: "/repos/shared/" });
  const failure = await expectFailureTag(
    harness.store.recordAgentSessionActivity({
      ...harness.scope,
      identity: session,
      occurredAt: Date.parse(session.startedAt) + 60_000,
    }),
    "HostOperationError",
  );
  expect(failure.message).toContain("More than one task owns session 'session-1'.");
  const records = await Effect.runPromise(
    harness.store.listAgentSessionsForTasks({ ...harness.scope, taskIds }),
  );
  expect(records.map((row) => row.agentSessions[0]?.lastActivityAt)).toEqual([
    undefined,
    undefined,
  ]);
});

test("workspace activity has its own saved time and keeps legacy records", async () => {
  const store = createSqliteWorkspaceSessionStore(harness);
  const scope = harness.scope;
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
    targetBranch: null,
    createdAt: 10,
    updatedAt: 100,
    archivedAt: null,
  };
  await Effect.runPromise(
    store.create({
      ...scope,
      session,
      ownershipScope: { catalogRevision: 0, workspaces: [scope] },
    }),
  );
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
