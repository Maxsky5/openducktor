import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  createAgentSessionRecord,
  describeTaskStorePortContract,
} from "../../ports/task-store-port-contract.test-support";
import { createSqliteTaskRepository } from "./sqlite-task-repository";
import { createSqliteTaskStoreHarness } from "./sqlite-task-store-test-support";

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
});
