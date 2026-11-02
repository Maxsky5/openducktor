import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import {
  createAgentSessionRecord,
  describeTaskStorePortContract,
} from "../../ports/task-store-port-contract.test-support";
import { createSqliteTaskRepository } from "./sqlite-task-repository";
import { createSqliteTaskStoreHarness, insertRawTask } from "./sqlite-task-store-test-support";
import { tasks, taskSessions } from "./sqlite-host-database-schema";
import { workspaces } from "./sqlite-host-settings-schema";

describeTaskStorePortContract("SQLite TaskStorePort contract", createSqliteTaskStoreHarness);

describe("SQLite task agent session batches", () => {
  test("returns an empty ID list without acquiring a database context", async () => {
    let contextCalls = 0;
    const store = createSqliteTaskRepository({
      contextProvider: () =>
        Effect.sync(() => {
          contextCalls += 1;
        }).pipe(Effect.andThen(Effect.die("The empty batch must not acquire SQLite."))),
    });

    await expect(
      Effect.runPromise(
        store.listAgentSessionsForTasks({ workspaceId: "test", repoPath: "/repo", taskIds: [] }),
      ),
    ).resolves.toEqual([]);
    expect(contextCalls).toBe(0);
  });

  test("lists multiple tasks and rejects missing tasks", async () => {
    const { cleanup, scope, store } = await createSqliteTaskStoreHarness();
    try {
      const firstTask = await Effect.runPromise(
        store.createTask({
          ...scope,
          status: "open",
          task: {
            title: "First sessions",
            issueType: "task",
            priority: 2,
          },
        }),
      );
      const secondTask = await Effect.runPromise(
        store.createTask({
          ...scope,
          status: "open",
          task: {
            title: "Second sessions",
            issueType: "task",
            priority: 2,
          },
        }),
      );
      const olderSession = createAgentSessionRecord({
        externalSessionId: "older-session",
        startedAt: "2026-06-10T10:00:00.000Z",
      });
      const newerSession = createAgentSessionRecord({
        externalSessionId: "newer-session",
        startedAt: "2026-06-10T11:00:00.000Z",
      });
      await Effect.runPromise(
        store.upsertAgentSession({
          ownershipScope: {
            catalogRevision: 0,
            workspaces: [scope],
          },
          ...scope,
          taskId: firstTask.id,
          session: olderSession,
        }),
      );
      await Effect.runPromise(
        store.upsertAgentSession({
          ownershipScope: {
            catalogRevision: 0,
            workspaces: [scope],
          },
          ...scope,
          taskId: firstTask.id,
          session: newerSession,
        }),
      );

      await expect(
        Effect.runPromise(
          store.listAgentSessionsForTasks({
            ...scope,
            taskIds: [secondTask.id, firstTask.id],
          }),
        ),
      ).resolves.toEqual([
        { taskId: secondTask.id, agentSessions: [] },
        { taskId: firstTask.id, agentSessions: [newerSession, olderSession] },
      ]);
      await expect(
        Effect.runPromise(
          store.listAgentSessionsForTasks({
            ...scope,
            taskIds: [firstTask.id, "missing-task"],
          }),
        ),
      ).rejects.toThrow("Task not found: missing-task");
      await expect(
        Effect.runPromise(store.listAgentSessionsForTasks({ ...scope, taskIds: [] })),
      ).resolves.toEqual([]);
    } finally {
      await cleanup?.();
    }
  });
});

const createSessionRows = async (records: AgentSessionRecord[]) => {
  let time = Date.parse("2026-06-10T12:00:00.000Z");
  const harness = await createSqliteTaskStoreHarness({ now: () => new Date(time++) });
  const { scope, store } = harness;
  const taskId = "session-rows";
  const identity = records[37]!;
  try {
    await Effect.runPromise(store.diagnoseRepoStore(scope));
    insertRawTask({
      databasePath: harness.databasePath,
      taskId,
      agentSessionsJson: JSON.stringify(records),
    });
    insertRawTask({
      databasePath: harness.databasePath,
      taskId: "sibling-session-rows",
      agentSessionsJson: JSON.stringify([identity]),
    });
    await Effect.runPromise(
      harness.withHostDatabase("test.seedSessionRows", (session) =>
        Effect.gen(function* () {
          const [task] = yield* session.execute(
            (database) => database.select().from(tasks).where(eq(tasks.id, taskId)),
            "test.sessionTask",
          );
          const [record] = yield* session.execute(
            (database) =>
              database
                .select()
                .from(taskSessions)
                .where(and(eq(taskSessions.taskId, taskId), eq(taskSessions.position, 37))),
            "test.sessionSession",
          );
          const workspaceId = "other-session-workspace";
          yield* session.execute(
            (database) =>
              database.insert(workspaces).values({
                workspaceId,
                workspaceName: "Other",
                repoPath: "/repos/other",
                branchPrefix: "task",
                defaultTargetBranch: "main",
                closed: false,
              }),
            "test.otherSessionWorkspace",
          );
          yield* session.execute(
            (database) => database.insert(tasks).values({ ...task!, workspaceId }),
            "test.otherSessionTask",
          );
          yield* session.execute(
            (database) => database.insert(taskSessions).values({ ...record!, workspaceId }),
            "test.otherSessionSession",
          );
          yield* session.execute(
            (database) =>
              database
                .update(taskSessions)
                .set({ position: sql`${taskSessions.position} * 3 + 1000` }),
            "test.spreadSessionPositions",
          );
          yield* session.execute(
            (database) =>
              database
                .update(taskSessions)
                .set({ position: 1111 })
                .where(eq(taskSessions.taskId, "sibling-session-rows")),
            "test.siblingSessionPosition",
          );
        }),
      ),
    );
    const snapshot = () =>
      Effect.runPromise(
        harness.withHostDatabase("test.sessionSnapshot", (session) =>
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
              "test.sessionRows",
            );
            const taskRows = yield* session.execute(
              (database) =>
                database.select().from(tasks).orderBy(asc(tasks.workspaceId), asc(tasks.id)),
              "test.sessionTasks",
            );
            const changes = yield* session.execute(
              (database) => database.values<[number]>(sql`select total_changes()`),
              "test.sessionChanges",
            );
            return { rows, taskRows, changes: changes[0]![0] };
          }),
        ),
      );
    return { ...harness, taskId, identity, snapshot };
  } catch (error) {
    await harness.cleanup();
    throw error;
  }
};

describe("SQLite task session deletes", () => {
  test.each([
    ["delete", 1],
    ["delete", 2],
    ["clear", 1],
    ["clear", 2],
  ] as const)("%s removes only %i matching rows among 100 sessions", async (operation, matches) => {
    const records = Array.from({ length: 100 }, (_, position) =>
      createAgentSessionRecord({ externalSessionId: `session-${position}` }),
    );
    records[37] = { ...records[37]!, role: "qa" };
    if (matches === 2)
      records[80] = {
        ...records[37]!,
        startedAt: "2026-06-10T11:00:00.000Z",
        lastActivityAt: Date.parse("2026-06-10T11:01:00.000Z"),
      };
    const harness = await createSessionRows(records);
    const { scope, store, taskId, identity, snapshot } = harness;
    const input = { ...scope, taskId };
    const mutate = () =>
      operation === "delete"
        ? store.deleteAgentSession({
            ...input,
            identity: {
              ...identity,
              externalSessionId: ` ${identity.externalSessionId} `,
              workingDirectory: `${identity.workingDirectory}/`,
            },
          })
        : store.clearAgentSessionsByRoles({ ...input, roles: [" qa ", "", "qa"] });
    try {
      const before = await snapshot();
      const metadataBefore = await Effect.runPromise(store.getTaskMetadata(input));
      expect(await Effect.runPromise(mutate())).toBe(true);
      const after = await snapshot();
      expect(after.changes - before.changes).toBe(matches + 1);
      expect(after.rows).toEqual(
        before.rows.filter(
          (row) =>
            row.workspaceId !== scope.workspaceId || row.taskId !== taskId || row.role !== "qa",
        ),
      );
      expect(after.taskRows).toEqual(
        before.taskRows.map((row) =>
          row.workspaceId === scope.workspaceId && row.id === taskId
            ? { ...row, updatedAt: new Date("2026-06-10T12:00:00.000Z") }
            : row,
        ),
      );
      const metadataAfter = await Effect.runPromise(store.getTaskMetadata(input));
      expect(metadataAfter.agentSessions).toEqual(
        metadataBefore.agentSessions.filter((record) => record.role !== "qa"),
      );

      expect(await Effect.runPromise(mutate())).toBe(true);
      const missing = await snapshot();
      expect(missing.changes - after.changes).toBe(operation === "clear" ? 1 : 0);
      expect(missing.rows).toEqual(after.rows);
      expect(missing.taskRows).toEqual(
        after.taskRows.map((row) =>
          operation === "clear" && row.workspaceId === scope.workspaceId && row.id === taskId
            ? { ...row, updatedAt: new Date("2026-06-10T12:00:00.001Z") }
            : row,
        ),
      );
      expect(
        await Effect.runPromise(store.clearAgentSessionsByRoles({ ...input, roles: [" ", ""] })),
      ).toBe(true);
      const empty = await snapshot();
      expect(empty.changes).toBe(missing.changes);
      expect(empty.rows).toEqual(missing.rows);
      expect(empty.taskRows).toEqual(missing.taskRows);

      const missingTaskInput = { ...input, taskId: "missing-task" };
      await expect(
        Effect.runPromise(
          operation === "delete"
            ? store.deleteAgentSession({ ...missingTaskInput, identity })
            : store.clearAgentSessionsByRoles({ ...missingTaskInput, roles: [] }),
        ),
      ).rejects.toThrow("Task not found: missing-task");
      expect(await snapshot()).toEqual(empty);
    } finally {
      await harness.cleanup();
    }
  });
});

describe("SQLite task session model updates", () => {
  test.each([1, 2])("changes only %i matching model rows among 100 sessions", async (matches) => {
    const records = Array.from({ length: 100 }, (_, position) =>
      createAgentSessionRecord({ externalSessionId: `session-${position}` }),
    );
    if (matches === 2)
      records[80] = {
        ...records[37]!,
        role: "qa",
        startedAt: "2026-06-10T11:00:00.000Z",
        lastActivityAt: Date.parse("2026-06-10T11:01:00.000Z"),
      };
    const harness = await createSessionRows(records);
    const { scope, store, taskId, identity, snapshot } = harness;
    try {
      const before = await snapshot();
      const model = {
        runtimeKind: "codex" as const,
        providerId: "openai",
        modelId: "gpt-6-sol",
        variant: "high",
        profileId: "build",
        speed: "priority" as const,
      };
      const input = {
        ...scope,
        taskId,
        identity: { ...identity, workingDirectory: `${identity.workingDirectory}/` },
      };
      expect(
        await Effect.runPromise(store.updateAgentSessionModel({ ...input, selectedModel: model })),
      ).toBe(true);
      const after = await snapshot();
      expect(after.changes - before.changes).toBe(matches + 1);
      expect(after.rows).toEqual(
        before.rows.map((row) =>
          row.workspaceId === scope.workspaceId &&
          row.taskId === taskId &&
          row.externalSessionId === identity.externalSessionId
            ? {
                ...row,
                modelRuntimeKind: "codex",
                modelProviderId: "openai",
                modelId: "gpt-6-sol",
                modelVariant: "high",
                modelProfileId: "build",
                modelSpeed: "priority",
              }
            : row,
        ),
      );
      expect(
        await Effect.runPromise(store.updateAgentSessionModel({ ...input, selectedModel: null })),
      ).toBe(true);
      const cleared = await snapshot();
      expect(cleared.changes - after.changes).toBe(matches + 1);
      expect(cleared.rows).toEqual(before.rows);
    } finally {
      await harness.cleanup();
    }
  });

  test("updates an existing record and never inserts a missing session", async () => {
    const { cleanup, scope, store } = await createSqliteTaskStoreHarness();
    try {
      const task = await Effect.runPromise(
        store.createTask({
          ...scope,
          status: "open",
          task: {
            title: "Session model",
            issueType: "task",
            priority: 2,
          },
        }),
      );
      const session = createAgentSessionRecord({ externalSessionId: "session-1" });
      const model = {
        runtimeKind: "opencode" as const,
        providerId: "openai",
        modelId: "gpt-5",
      };
      await Effect.runPromise(
        store.upsertAgentSession({
          ownershipScope: {
            catalogRevision: 0,
            workspaces: [scope],
          },
          ...scope,
          taskId: task.id,
          session,
        }),
      );

      await Effect.runPromise(
        store.updateAgentSessionModel({
          ...scope,
          taskId: task.id,
          identity: session,
          selectedModel: model,
        }),
      );
      await expect(
        Effect.runPromise(store.getTaskMetadata({ ...scope, taskId: task.id })),
      ).resolves.toMatchObject({
        agentSessions: [
          expect.objectContaining({ externalSessionId: "session-1", selectedModel: model }),
        ],
      });

      await expect(
        Effect.runPromise(
          store.updateAgentSessionModel({
            ...scope,
            taskId: task.id,
            identity: { ...session, externalSessionId: "missing-session" },
            selectedModel: null,
          }),
        ),
      ).rejects.toThrow("Task session not found: missing-session");
      await expect(
        Effect.runPromise(store.getTaskMetadata({ ...scope, taskId: task.id })),
      ).resolves.toMatchObject({
        agentSessions: [expect.objectContaining({ externalSessionId: "session-1" })],
      });
    } finally {
      await cleanup();
    }
  });

  test("stores a selection that omits an undefined profile and keeps its speed", async () => {
    const { cleanup, scope, store } = await createSqliteTaskStoreHarness();
    try {
      const task = await Effect.runPromise(
        store.createTask({
          ...scope,
          status: "open",
          task: {
            title: "Codex session model",
            issueType: "bug",
            priority: 1,
          },
        }),
      );
      const session = createAgentSessionRecord({
        externalSessionId: "codex-session",
        runtimeKind: "codex",
      });
      await Effect.runPromise(
        store.upsertAgentSession({
          ownershipScope: {
            catalogRevision: 0,
            workspaces: [scope],
          },
          ...scope,
          taskId: task.id,
          session,
        }),
      );

      await expect(
        Effect.runPromise(
          store.updateAgentSessionModel({
            ...scope,
            taskId: task.id,
            identity: session,
            selectedModel: {
              runtimeKind: "codex",
              providerId: "openai",
              modelId: "gpt-5.6-sol",
              profileId: undefined,
              speed: "priority",
            },
          }),
        ),
      ).resolves.toBe(true);

      const metadata = await Effect.runPromise(
        store.getTaskMetadata({ ...scope, taskId: task.id }),
      );
      const storedSession = metadata.agentSessions.find(
        (entry) => entry.externalSessionId === "codex-session",
      );
      expect(storedSession?.selectedModel).toStrictEqual({
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5.6-sol",
        speed: "priority",
      });
    } finally {
      await cleanup();
    }
  });
});

describe("SQLite task session batches with nullable optional selection fields", () => {
  const nullableSessionsJson = JSON.stringify([
    {
      externalSessionId: "legacy-session",
      role: "build",
      startedAt: "2026-06-10T10:00:00.000Z",
      runtimeKind: "codex",
      workingDirectory: "/repos/fairnest/worktrees/legacy-session",
      selectedModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-6-astra",
        variant: null,
        profileId: null,
      },
    },
    {
      externalSessionId: "target-session",
      role: "qa",
      startedAt: "2026-06-10T11:00:00.000Z",
      runtimeKind: "codex",
      workingDirectory: "/repos/fairnest/worktrees/target-session",
      selectedModel: null,
    },
  ]);

  const targetIdentity = {
    externalSessionId: "target-session",
    runtimeKind: "codex",
    workingDirectory: "/repos/fairnest/worktrees/target-session",
  } as const;

  const createTaskWithNullableSession = async () => {
    const harness = await createSqliteTaskStoreHarness();
    await Effect.runPromise(harness.store.diagnoseRepoStore(harness.scope));
    const taskId = "fairnest-nullable-session";
    insertRawTask({
      databasePath: harness.databasePath,
      taskId,
      agentSessionsJson: nullableSessionsJson,
    });
    return { ...harness, taskId };
  };

  const readSessions = async (
    store: TaskStorePort,
    scope: { workspaceId: string; repoPath: string },
    taskId: string,
  ): Promise<AgentSessionRecord[]> => {
    const metadata = await Effect.runPromise(store.getTaskMetadata({ ...scope, taskId }));
    return metadata.agentSessions;
  };

  const expectLegacySelection = (sessions: AgentSessionRecord[]): void => {
    const legacy = sessions.find((entry) => entry.externalSessionId === "legacy-session");
    expect(legacy?.selectedModel).toStrictEqual({
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-6-astra",
    });
  };

  test("upserts a session next to an unchanged sibling with nullable fields", async () => {
    const { cleanup, scope, store, taskId } = await createTaskWithNullableSession();
    try {
      await expect(
        Effect.runPromise(
          store.upsertAgentSession({
            ownershipScope: {
              catalogRevision: 0,
              workspaces: [scope],
            },
            ...scope,
            taskId,
            session: createAgentSessionRecord({
              externalSessionId: "added-session",
              role: "build",
              startedAt: "2026-06-10T12:00:00.000Z",
            }),
          }),
        ),
      ).resolves.toBe(true);

      const sessions = await readSessions(store, scope, taskId);
      expectLegacySelection(sessions);
      expect(sessions.map((session) => session.externalSessionId)).toEqual([
        "added-session",
        "target-session",
        "legacy-session",
      ]);
    } finally {
      await cleanup();
    }
  });

  test("updates a model next to an unchanged sibling with nullable fields", async () => {
    const { cleanup, scope, store, taskId } = await createTaskWithNullableSession();
    try {
      await expect(
        Effect.runPromise(
          store.updateAgentSessionModel({
            ...scope,
            taskId,
            identity: targetIdentity,
            selectedModel: {
              runtimeKind: "codex",
              providerId: "openai",
              modelId: "gpt-5.6-sol",
            },
          }),
        ),
      ).resolves.toBe(true);

      const sessions = await readSessions(store, scope, taskId);
      expectLegacySelection(sessions);
      expect(
        sessions.find((session) => session.externalSessionId === "target-session")?.selectedModel,
      ).toStrictEqual({
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5.6-sol",
      });
    } finally {
      await cleanup();
    }
  });

  test("clears sessions by role next to an unchanged sibling with nullable fields", async () => {
    const { cleanup, scope, store, taskId } = await createTaskWithNullableSession();
    try {
      await expect(
        Effect.runPromise(store.clearAgentSessionsByRoles({ ...scope, taskId, roles: ["qa"] })),
      ).resolves.toBe(true);

      const sessions = await readSessions(store, scope, taskId);
      expectLegacySelection(sessions);
      expect(sessions.map((session) => session.externalSessionId)).toEqual(["legacy-session"]);
    } finally {
      await cleanup();
    }
  });

  test("deletes a session next to an unchanged sibling with nullable fields", async () => {
    const { cleanup, scope, store, taskId } = await createTaskWithNullableSession();
    try {
      await expect(
        Effect.runPromise(store.deleteAgentSession({ ...scope, taskId, identity: targetIdentity })),
      ).resolves.toBe(true);

      const sessions = await readSessions(store, scope, taskId);
      expectLegacySelection(sessions);
      expect(sessions.map((session) => session.externalSessionId)).toEqual(["legacy-session"]);
    } finally {
      await cleanup();
    }
  });
});
