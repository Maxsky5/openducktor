import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import { hostDatabaseSchema } from "../../adapters/sqlite/sqlite-host-database-schema";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { createTaskService } from "./task-service";

type LoggedQuery = {
  readonly params: unknown[];
  readonly sql: string;
};

const expectScopedAgentSessionReads = (
  queries: LoggedQuery[],
  workspaceId: string,
  taskId: string,
): void => {
  expect(queries).toHaveLength(2);
  expect(queries[0]?.sql).toMatch(/^select "id" from "tasks"/i);
  expect(queries[0]?.params).toEqual([workspaceId, JSON.stringify([taskId])]);
  expect(queries[1]?.sql).toContain('from "task_sessions"');
  expect(queries[1]?.params).toEqual([workspaceId, JSON.stringify([taskId])]);
  expect(queries.some(({ sql }) => sql.includes("task_artifacts"))).toBe(false);
};

describe("single-task session queries", () => {
  test("requires a result from the single-ID batch call", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskStore: createTaskStoreTestDouble({
        listAgentSessionsForTasks: (input) => {
          calls.push(input);
          return Effect.succeed([]);
        },
      }),
    });
    const failure = await Effect.runPromise(
      Effect.flip(
        service.agentSessionsList({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
      ),
    );
    expect(calls).toEqual([{ workspaceId: "repo", repoPath: "/repo", taskIds: ["task-1"] }]);
    expect(failure).toMatchObject({
      _tag: "HostInvariantError",
      invariant: "task-agent-sessions-result",
    });
  });
  test("uses scoped task and session reads and preserves full metadata", async () => {
    const harness = await createSqliteTaskStoreHarness();
    const { repoPath, store } = harness;
    try {
      const task = await Effect.runPromise(
        store.createTask({
          ...harness.scope,
          status: "open",
          task: { title: "Session query", issueType: "task", priority: 2 },
        }),
      );
      const input = { workspaceId: harness.workspaceId, repoPath, taskId: task.id };
      const markdown = "Unrelated document content.";
      await Effect.runPromise(
        store.saveWorkflowArtifact({
          decide: (current) =>
            Result.succeed({
              status: current.status,
              workflowId: "openducktor-research-plan-implement",
            }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...input,
          markdown,
          code: "spec",
        }),
      );
      await Effect.runPromise(
        store.saveWorkflowArtifact({
          decide: (current) =>
            Result.succeed({
              status: current.status,
              workflowId: "openducktor-research-plan-implement",
            }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...input,
          markdown,
          code: "plan",
        }),
      );
      await Effect.runPromise(
        store.saveWorkflowArtifact({
          decide: () =>
            Result.succeed({
              status: "human_review",
              workflowId: "openducktor-research-plan-implement",
            }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...input,
          markdown,
          verdict: "approved",
          code: "qaReport",
        }),
      );

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const queries: LoggedQuery[] = [];
            const connection = yield* openSqliteDrizzleConnection({
              databasePath: harness.databasePath,
              configureWal: false,
              config: {
                schema: hostDatabaseSchema,
                logger: {
                  logQuery(sql, params) {
                    queries.push({ params, sql });
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
            const service = createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore });
            expect(yield* service.agentSessionsList(input)).toEqual([]);
            expectScopedAgentSessionReads(queries, harness.workspaceId, input.taskId);

            const older = createAgentSessionRecord({
              externalSessionId: "older",
              startedAt: "2026-06-10T10:00:00.000Z",
            });
            const newer = createAgentSessionRecord({
              externalSessionId: "newer",
              startedAt: "2026-06-10T11:00:00.000Z",
            });
            yield* store.upsertAgentSession({
              ...input,
              ownershipScope: {
                catalogRevision: 0,
                workspaces: [{ workspaceId: harness.workspaceId, repoPath }],
              },
              session: newer,
            });
            yield* store.upsertAgentSession({
              ...input,
              ownershipScope: {
                catalogRevision: 0,
                workspaces: [{ workspaceId: harness.workspaceId, repoPath }],
              },
              session: older,
            });
            queries.length = 0;
            expect(yield* service.agentSessionsList(input)).toEqual([newer, older]);
            expectScopedAgentSessionReads(queries, harness.workspaceId, input.taskId);

            queries.length = 0;
            const failure = yield* Effect.flip(
              service.agentSessionsList({
                workspaceId: harness.workspaceId,
                repoPath,
                taskId: "missing-task",
              }),
            );
            expect(failure).toMatchObject({
              _tag: "HostResourceError",
              resource: "task",
              message: "Task not found: missing-task",
              details: { repoPath, taskId: "missing-task" },
            });
            expectScopedAgentSessionReads(queries, harness.workspaceId, "missing-task");

            const metadata = yield* service.getTaskMetadata(input);
            expect(metadata).toMatchObject({
              artifacts: {
                spec: { markdown },
                plan: { markdown },
                qaReport: { markdown, verdict: "approved" },
              },
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
