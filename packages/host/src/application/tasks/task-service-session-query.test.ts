import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import { taskStoreSchema } from "../../adapters/sqlite/sqlite-task-store-schema";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { createTaskService } from "./task-service";

describe("single-task session queries", () => {
  test("requires a result from the single-ID batch call", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskStore: createTaskStoreTestDouble({
        listAgentSessionsForTasks: (input) => {
          calls.push(input);
          return Effect.succeed([]);
        },
      }),
    });
    const failure = await Effect.runPromise(
      Effect.flip(service.agentSessionsList({ repoPath: "/repo", taskId: "task-1" })),
    );
    expect(calls).toEqual([{ repoPath: "/repo", taskIds: ["task-1"] }]);
    expect(failure).toMatchObject({
      _tag: "HostInvariantError",
      invariant: "task-agent-sessions-result",
    });
  });
  test("uses one narrow SELECT and preserves sessions, missing tasks, and full metadata", async () => {
    const harness = await createSqliteTaskStoreHarness();
    const { repoPath, store } = harness;
    try {
      const task = await Effect.runPromise(
        store.createTask({
          repoPath,
          task: { title: "Session query", issueType: "task", priority: 2, aiReviewEnabled: true },
        }),
      );
      const input = { repoPath, taskId: task.id };
      const markdown = "Unrelated document content.\n".repeat(40_000).trim();
      await Effect.runPromise(store.setSpecDocument({ ...input, markdown }));
      await Effect.runPromise(store.setPlanDocument({ ...input, markdown }));
      await Effect.runPromise(
        store.recordQaOutcome({ ...input, markdown, verdict: "approved", status: "human_review" }),
      );

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const queries: string[] = [];
            const connection = yield* openSqliteDrizzleConnection({
              databasePath: harness.databasePath,
              configureWal: false,
              config: {
                schema: taskStoreSchema,
                logger: {
                  logQuery(query) {
                    queries.push(query);
                  },
                },
              },
            });
            const taskStore = createSqliteTaskRepository({
              contextProvider: (path, operation, use) =>
                harness.contextProvider(path, operation, (context) =>
                  use({ ...context, session: connection.session }),
                ),
            });
            const service = createTaskService({ taskStore });
            expect(yield* service.agentSessionsList(input)).toEqual([]);
            expect(queries).toHaveLength(1);
            expect(queries[0]).toMatch(/^select "id", "agent_sessions_json" from "tasks"/i);
            expect(queries.join("\n")).not.toContain("task_documents");

            const older = createAgentSessionRecord({
              externalSessionId: "older",
              startedAt: "2026-06-10T10:00:00.000Z",
            });
            const newer = createAgentSessionRecord({
              externalSessionId: "newer",
              startedAt: "2026-06-10T11:00:00.000Z",
            });
            yield* store.upsertAgentSession({ ...input, session: newer });
            yield* store.upsertAgentSession({ ...input, session: older });
            queries.length = 0;
            expect(yield* service.agentSessionsList(input)).toEqual([newer, older]);
            expect(queries).toHaveLength(1);
            expect(queries[0]).toMatch(/^select "id", "agent_sessions_json" from "tasks"/i);
            expect(queries.join("\n")).not.toContain("task_documents");

            queries.length = 0;
            const failure = yield* Effect.flip(
              service.agentSessionsList({ repoPath, taskId: "missing-task" }),
            );
            expect(failure).toMatchObject({
              _tag: "HostResourceError",
              resource: "task",
              message: "Task not found: missing-task",
              details: { repoPath, taskId: "missing-task" },
            });
            expect(queries).toHaveLength(1);
            expect(queries.join("\n")).not.toContain("task_documents");

            const metadata = yield* service.getTaskMetadata(input);
            expect(metadata).toMatchObject({
              spec: { markdown },
              plan: { markdown },
              qaReport: { markdown, verdict: "approved" },
              agentSessions: [newer, older],
            });
          }),
        ),
      );
    } finally {
      await harness.cleanup();
    }
  });
});
