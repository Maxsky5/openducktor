import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import {
  createAgentSessionRecord,
  describeTaskStorePortContract,
} from "../../ports/task-store-port-contract.test-support";
import { createSqliteTaskRepository } from "./sqlite-task-repository";
import { createSqliteTaskStoreHarness, insertRawTask } from "./sqlite-task-store-test-support";

describeTaskStorePortContract("SQLite TaskStorePort contract", createSqliteTaskStoreHarness);

describe("SQLite task agent session batches", () => {
  test("returns an empty ID list without acquiring a database context", async () => {
    let contextCalls = 0;
    const store = createSqliteTaskRepository({
      contextProvider: () =>
        Effect.sync(() => {
          contextCalls += 1;
        }).pipe(Effect.zipRight(Effect.die("The empty batch must not acquire SQLite."))),
    });

    await expect(
      Effect.runPromise(store.listAgentSessionsForTasks({ repoPath: "/repo", taskIds: [] })),
    ).resolves.toEqual([]);
    expect(contextCalls).toBe(0);
  });

  test("lists multiple tasks and rejects missing tasks", async () => {
    const { cleanup, repoPath, store } = await createSqliteTaskStoreHarness();
    try {
      const firstTask = await Effect.runPromise(
        store.createTask({
          repoPath,
          task: {
            title: "First sessions",
            issueType: "task",
            priority: 2,
            aiReviewEnabled: true,
          },
        }),
      );
      const secondTask = await Effect.runPromise(
        store.createTask({
          repoPath,
          task: {
            title: "Second sessions",
            issueType: "task",
            priority: 2,
            aiReviewEnabled: true,
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
        store.upsertAgentSession({ repoPath, taskId: firstTask.id, session: olderSession }),
      );
      await Effect.runPromise(
        store.upsertAgentSession({ repoPath, taskId: firstTask.id, session: newerSession }),
      );

      await expect(
        Effect.runPromise(
          store.listAgentSessionsForTasks({
            repoPath,
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
            repoPath,
            taskIds: [firstTask.id, "missing-task"],
          }),
        ),
      ).rejects.toThrow("Task not found: missing-task");
      await expect(
        Effect.runPromise(store.listAgentSessionsForTasks({ repoPath, taskIds: [] })),
      ).resolves.toEqual([]);
    } finally {
      await cleanup?.();
    }
  });
});

describe("SQLite task session model updates", () => {
  test("updates an existing record and never inserts a missing session", async () => {
    const { cleanup, repoPath, store } = await createSqliteTaskStoreHarness();
    try {
      const task = await Effect.runPromise(
        store.createTask({
          repoPath,
          task: {
            title: "Session model",
            issueType: "task",
            priority: 2,
            aiReviewEnabled: true,
          },
        }),
      );
      const session = createAgentSessionRecord({ externalSessionId: "session-1" });
      const model = {
        runtimeKind: "opencode" as const,
        providerId: "openai",
        modelId: "gpt-5",
      };
      await Effect.runPromise(store.upsertAgentSession({ repoPath, taskId: task.id, session }));

      await Effect.runPromise(
        store.updateAgentSessionModel({
          repoPath,
          taskId: task.id,
          identity: session,
          selectedModel: model,
        }),
      );
      await expect(
        Effect.runPromise(store.getTaskMetadata({ repoPath, taskId: task.id })),
      ).resolves.toMatchObject({
        agentSessions: [
          expect.objectContaining({ externalSessionId: "session-1", selectedModel: model }),
        ],
      });

      await expect(
        Effect.runPromise(
          store.updateAgentSessionModel({
            repoPath,
            taskId: task.id,
            identity: { ...session, externalSessionId: "missing-session" },
            selectedModel: null,
          }),
        ),
      ).rejects.toThrow("Task session not found: missing-session");
      await expect(
        Effect.runPromise(store.getTaskMetadata({ repoPath, taskId: task.id })),
      ).resolves.toMatchObject({
        agentSessions: [expect.objectContaining({ externalSessionId: "session-1" })],
      });
    } finally {
      await cleanup();
    }
  });

  test("stores a selection that omits an undefined profile", async () => {
    const { cleanup, repoPath, store } = await createSqliteTaskStoreHarness();
    try {
      const task = await Effect.runPromise(
        store.createTask({
          repoPath,
          task: {
            title: "Codex session model",
            issueType: "bug",
            priority: 1,
            aiReviewEnabled: true,
          },
        }),
      );
      const session = createAgentSessionRecord({
        externalSessionId: "codex-session",
        runtimeKind: "codex",
      });
      await Effect.runPromise(store.upsertAgentSession({ repoPath, taskId: task.id, session }));

      await expect(
        Effect.runPromise(
          store.updateAgentSessionModel({
            repoPath,
            taskId: task.id,
            identity: session,
            selectedModel: {
              runtimeKind: "codex",
              providerId: "openai",
              modelId: "gpt-5.6-sol",
              profileId: undefined,
            },
          }),
        ),
      ).resolves.toBe(true);

      const metadata = await Effect.runPromise(
        store.getTaskMetadata({ repoPath, taskId: task.id }),
      );
      const storedSession = metadata.agentSessions.find(
        (entry) => entry.externalSessionId === "codex-session",
      );
      expect(storedSession?.selectedModel).toStrictEqual({
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5.6-sol",
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
    await Effect.runPromise(harness.store.diagnoseRepoStore({ repoPath: harness.repoPath }));
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
    repoPath: string,
    taskId: string,
  ): Promise<AgentSessionRecord[]> => {
    const metadata = await Effect.runPromise(store.getTaskMetadata({ repoPath, taskId }));
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
    const { cleanup, repoPath, store, taskId } = await createTaskWithNullableSession();
    try {
      await expect(
        Effect.runPromise(
          store.upsertAgentSession({
            repoPath,
            taskId,
            session: createAgentSessionRecord({
              externalSessionId: "added-session",
              role: "build",
              startedAt: "2026-06-10T12:00:00.000Z",
            }),
          }),
        ),
      ).resolves.toBe(true);

      const sessions = await readSessions(store, repoPath, taskId);
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
    const { cleanup, repoPath, store, taskId } = await createTaskWithNullableSession();
    try {
      await expect(
        Effect.runPromise(
          store.updateAgentSessionModel({
            repoPath,
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

      const sessions = await readSessions(store, repoPath, taskId);
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
    const { cleanup, repoPath, store, taskId } = await createTaskWithNullableSession();
    try {
      await expect(
        Effect.runPromise(store.clearAgentSessionsByRoles({ repoPath, taskId, roles: ["qa"] })),
      ).resolves.toBe(true);

      const sessions = await readSessions(store, repoPath, taskId);
      expectLegacySelection(sessions);
      expect(sessions.map((session) => session.externalSessionId)).toEqual(["legacy-session"]);
    } finally {
      await cleanup();
    }
  });

  test("deletes a session next to an unchanged sibling with nullable fields", async () => {
    const { cleanup, repoPath, store, taskId } = await createTaskWithNullableSession();
    try {
      await expect(
        Effect.runPromise(store.deleteAgentSession({ repoPath, taskId, identity: targetIdentity })),
      ).resolves.toBe(true);

      const sessions = await readSessions(store, repoPath, taskId);
      expectLegacySelection(sessions);
      expect(sessions.map((session) => session.externalSessionId)).toEqual(["legacy-session"]);
    } finally {
      await cleanup();
    }
  });
});
