import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { hostDatabaseSchema } from "./sqlite-host-database-schema";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { readTaskSessionsForTasks, replaceTaskLabels } from "./sqlite-task-relations";
import { artifactSummariesByTaskId } from "./sqlite-task-workflow-artifact-queries";
import { createSqliteTaskStoreHarness } from "./sqlite-task-store-test-support";

test("reads large ID sets and writes large label sets within the Node parameter limit", async () => {
  const harness = await createSqliteTaskStoreHarness();
  try {
    const task = await Effect.runPromise(
      harness.store.createTask({
        ...harness.scope,
        status: "open",
        task: { title: "Large collections", issueType: "task", priority: 2 },
      }),
    );
    const ids = [task.id, ...Array.from({ length: 33_000 }, (_, index) => `missing-${index}`)];
    const labels = Array.from(
      { length: 8_200 },
      (_, index) => `label-${String(index).padStart(5, "0")}`,
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* openSqliteDrizzleConnection({
            databasePath: harness.databasePath,
            configureWal: false,
            config: {
              schema: hostDatabaseSchema,
              logger: {
                logQuery: (_sql, params) => expect(params.length).toBeLessThanOrEqual(32_766),
              },
            },
          });
          const bounded = connection.session;
          const workspaceId = harness.workspaceId;
          yield* replaceTaskLabels(bounded, workspaceId, task.id, labels);
          const sessions = yield* readTaskSessionsForTasks(bounded, workspaceId, ids);
          expect(sessions.size).toBe(ids.length);
          expect(sessions.get(task.id)).toEqual([]);
          const workflow = builtinTaskWorkflows.forNewTask(harness.repoPath);
          const summaries = yield* artifactSummariesByTaskId(
            bounded,
            workspaceId,
            new Map(ids.map((id) => [id, workflow])),
          );
          expect(summaries.size).toBe(ids.length);
          expect(summaries.get(task.id)?.spec?.present).toBe(false);
        }),
      ),
    );
    const cards = await Effect.runPromise(
      harness.store.listTasks({ ...harness.scope, taskIds: ids }),
    );
    expect(cards.map(({ id }) => id)).toEqual([task.id]);
    expect(cards[0]?.labels).toEqual(labels);
  } finally {
    await harness.cleanup();
  }
});
