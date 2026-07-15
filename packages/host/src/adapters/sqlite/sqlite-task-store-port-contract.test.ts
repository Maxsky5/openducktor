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
  test("returns an empty normalized ID list without resolving storage", async () => {
    let resolverCalls = 0;
    const store = createSqliteTaskRepository({
      resolveWorkspaceIdForRepoPath: () =>
        Effect.sync(() => {
          resolverCalls += 1;
          return "workspace";
        }),
    });

    await expect(
      Effect.runPromise(store.listAgentSessionsForTasks({ repoPath: "/repo", taskIds: [" ", ""] })),
    ).resolves.toEqual([]);
    expect(resolverCalls).toBe(0);
  });

  test("lists multiple tasks, ignores duplicate IDs, and rejects missing tasks", async () => {
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
            taskIds: [secondTask.id, firstTask.id, firstTask.id],
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
