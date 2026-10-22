import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { repoConfigSchema } from "@openducktor/contracts";
import type { JSONType } from "zod";
import { HostOperationError } from "../../effect/host-errors";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { taskRowFixture } from "../../adapters/sqlite/sqlite-task-row-test-fixtures";
import { taskDocuments, tasks } from "../../adapters/sqlite/sqlite-task-store-schema";
import { createTaskService } from "../tasks/task-service";
import { resolveTaskReference } from "./odt-mcp-bridge-model";
import { executeOdtMcpReadTool } from "./odt-mcp-bridge-read-tools";
import { createOdtMcpToolContext, type OdtMcpReadToolName } from "./odt-mcp-bridge-tool-context";

type Read = { operation: string; columns: string[]; count: number };

describe("focused MCP task reads", () => {
  let harness: SqliteTaskStoreTestHarness;
  let context: ReturnType<typeof createOdtMcpToolContext>;
  let reads: Read[];
  let failOperation: string | undefined;
  const databaseFailure = new HostOperationError({
    operation: "test.database",
    message: "Database read failed",
  });
  const assetId = "28cb7c3d-5ec4-47e8-bffe-090223eae3b7";

  beforeEach(async () => {
    harness = await createSqliteTaskStoreHarness();
    reads = [];
    failOperation = undefined;
    await seedTasks(harness);
    context = createContext();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test.each([
    ["odt_read_task", {}],
    ["odt_read_task_documents", { includeSpec: true, includeQaReport: true }],
    ["odt_read_task_assets", { assetIds: [assetId] }],
  ] satisfies Array<[OdtMcpReadToolName, JSONType]>)(
    "%s preserves its public response with bounded full rows for every reference form",
    async (toolName, input) => {
      const allTasks = await Effect.runPromise(
        context.taskService.listTasks({ repoPath: harness.repoPath }),
      );
      const listContext = {
        ...context,
        taskForWorkspace: (_workspaceId: string, taskId: string) =>
          Effect.sync(() => resolveTaskReference(allTasks, taskId)),
      };
      const expected = await Effect.runPromise(
        executeOdtMcpReadTool(listContext, toolName, {
          workspaceId: "fixture",
          taskId: "repo-0",
          ...input,
        }),
      );
      for (const taskId of [
        "repo-0",
        "REPO-0",
        "0",
        "Focused lookup: final result",
        "focused-lookup-final-result",
        "final result",
      ]) {
        reads.length = 0;
        const actual = await Effect.runPromise(
          executeOdtMcpReadTool(context, toolName, { workspaceId: "fixture", taskId, ...input }),
        );
        expect(actual).toEqual(expected);
        expect(
          reads
            .filter((read) => read.columns.includes("description"))
            .reduce((sum, read) => sum + read.count, 0),
        ).toBeLessThanOrEqual(toolName === "odt_read_task_documents" ? 2 : 1);
        expect(
          reads
            .filter((read) => read.columns.includes("kind") && !read.columns.includes("markdown"))
            .reduce((sum, read) => sum + read.count, 0),
        ).toBe(3);
        if (taskId === "repo-0")
          expect(
            reads.some((read) => read.columns.length === 2 && read.columns.includes("title")),
          ).toBe(false);
      }
    },
  );

  test("preserves reference precedence, ambiguity titles, and candidate order", async () => {
    const candidates = [
      { id: "Alpha", title: "First ID" },
      { id: "alpha", title: "Second ID" },
      { id: "target-token", title: "ID segment" },
      { id: "title-choice", title: "token" },
      { id: "title-exact", title: "Exact title" },
      { id: "slug-only", title: "Exact-title" },
      { id: "slug-match", title: "Slug winner!" },
      { id: "substring", title: "Extra slug winner here" },
      { id: "dup-1", title: "Same title" },
      { id: "dup-2", title: "Same title" },
      { id: "punct-1", title: "Slug pair!" },
      { id: "punct-2", title: "Slug pair?" },
    ];
    await Effect.runPromise(
      harness.contextProvider(harness.repoPath, "test.replaceTasks", ({ session }) =>
        Effect.gen(function* () {
          yield* session.execute((db) => db.delete(tasks), "test.deleteTasks");
          yield* session.execute(
            (db) =>
              db.insert(tasks).values(candidates.map((candidate) => taskRowFixture(candidate))),
            "test.insertTasks",
          );
        }),
      ),
    );
    for (const [taskId, expectedId] of [
      ["alpha", "alpha"],
      ["Alpha", "Alpha"],
      ["TOKEN", "target-token"],
      ["exact title", "title-exact"],
      ["slug-winner", "slug-match"],
      ["extra slug", "substring"],
    ] as const) {
      const result = await Effect.runPromise(
        executeOdtMcpReadTool(context, "odt_read_task", { workspaceId: "fixture", taskId }),
      );
      expect(result).toMatchObject({ task: { id: expectedId } });
    }
    const expectedErrors = [
      [
        "aLpHa",
        'Task identifier "aLpHa" is ambiguous. Use exact task id. Candidates: Alpha (First ID), alpha (Second ID)',
      ],
      [
        "dup",
        'Task identifier "dup" is ambiguous. Use exact task id. Candidates: dup-1 (Same title), dup-2 (Same title)',
      ],
      [
        "same title",
        'Task identifier "same title" is ambiguous. Use exact task id. Candidates: dup-1 (Same title), dup-2 (Same title)',
      ],
      [
        "slug-pair",
        'Task identifier "slug-pair" is ambiguous. Use exact task id. Candidates: punct-1 (Slug pair!), punct-2 (Slug pair?)',
      ],
      [
        "winner",
        'Task identifier "winner" is ambiguous. Use exact task id. Candidates: slug-match (Slug winner!), substring (Extra slug winner here)',
      ],
      ["targ", "Task not found: targ. Candidate task ids: target-token (ID segment)"],
      [
        "missing",
        "Task not found: missing. Candidate task ids: Alpha (First ID), alpha (Second ID), dup-1 (Same title), dup-2 (Same title), punct-1 (Slug pair!)",
      ],
    ] as const;
    for (const [taskId, message] of expectedErrors) {
      reads.length = 0;
      const error = await Effect.runPromise(
        context.taskForWorkspace("fixture", taskId).pipe(Effect.flip),
      );
      expect(error).toMatchObject({ _tag: "HostValidationError", message });
      expect(
        reads.some((read) => read.columns.includes("description") || read.columns.includes("kind")),
      ).toBe(false);
    }
  });

  test("keeps full-list candidate ordering across open and closed task lanes", async () => {
    const allTasks = await Effect.runPromise(
      context.taskService.listTasks({ repoPath: harness.repoPath }),
    );
    for (const taskId of ["Other task", "not-present"]) {
      const expected = await Effect.runPromise(
        context.resolveTask(allTasks, taskId).pipe(Effect.flip),
      );
      const actual = await Effect.runPromise(
        context.taskForWorkspace("fixture", taskId).pipe(Effect.flip),
      );
      expect(actual.message).toBe(expected.message);
      expect(actual).toMatchObject({ _tag: expected._tag, details: expected.details });
    }
  });

  test("keeps the missing-task error for an empty workspace", async () => {
    await Effect.runPromise(
      harness.contextProvider(harness.repoPath, "test.deleteTasks", ({ session }) =>
        session.execute((db) => db.delete(tasks), "test.deleteTasks"),
      ),
    );
    const error = await Effect.runPromise(
      context.taskForWorkspace("fixture", "missing").pipe(Effect.flip),
    );
    expect(error.message).toBe("Task not found: missing.");
  });

  test("fails without another lookup when the selected task is deleted after the candidate read", async () => {
    const taskId = "Focused lookup: final result";
    const afterDelete = createOdtMcpToolContext({
      ...context,
      taskService: {
        ...context.taskService,
        listTaskReferences: (input) =>
          context.taskService.listTaskReferences(input).pipe(
            Effect.tap(() =>
              harness.store.deleteTask({
                repoPath: harness.repoPath,
                taskId: "repo-0",
                deleteSubtasks: false,
              }),
            ),
          ),
      },
    });

    const error = await Effect.runPromise(
      executeOdtMcpReadTool(afterDelete, "odt_read_task", { workspaceId: "fixture", taskId }).pipe(
        Effect.flip,
      ),
    );

    expect(error).toMatchObject({
      _tag: "HostValidationError",
      message: `Task not found: ${taskId}.`,
      details: { operation: "odt_mcp_bridge.resolve_task_reference" },
      cause: {
        _tag: "HostValidationError",
        field: "taskId",
        message: `Task not found: ${taskId}.`,
        details: { taskId },
      },
    });
    expect(reads.map((read) => read.operation)).toEqual([
      "sqliteTaskStore.getTaskRow.selectTask",
      "sqliteTaskStore.taskReferenceCandidates.selectTasks",
      "sqliteTaskStore.getTaskRow.selectTask",
    ]);
    expect(
      await Effect.runPromise(
        harness.store.findTask({ repoPath: harness.repoPath, taskId: "repo-0" }),
      ),
    ).toBeNull();
  });

  test.each([
    ["sqliteTaskStore.getTaskRow.selectTask", "repo-0"],
    ["sqliteTaskStore.documentSummariesByTaskId.selectLatestDocuments", "repo-0"],
    ["sqliteTaskStore.taskReferenceCandidates.selectTasks", "REPO-0"],
  ])("propagates a database failure in %s without another read", async (operation, taskId) => {
    failOperation = operation;
    const error = await Effect.runPromise(
      context.taskForWorkspace("fixture", taskId).pipe(Effect.flip),
    );
    expect(error).toBe(databaseFailure);
    expect(reads.at(-1)?.operation).toBe(operation);
    expect(reads.map((read) => read.operation)).not.toContain(
      "sqliteTaskStore.taskRows.selectTasks",
    );
  });

  test("checks the workspace before task lookup", async () => {
    const error = new HostOperationError({
      operation: "workspace.config",
      message: "Workspace is closed",
    });
    const denied = createOdtMcpToolContext({
      ...context,
      workspaceSettingsService: {
        ...context.workspaceSettingsService,
        getRepoConfig: () => Effect.fail(error),
      },
    });
    expect(
      await Effect.runPromise(denied.taskForWorkspace("fixture", "repo-0").pipe(Effect.flip)),
    ).toBe(error);
    expect(reads).toEqual([]);
  });

  function createContext(): ReturnType<typeof createOdtMcpToolContext> {
    const store = createSqliteTaskRepository({
      contextProvider: (repoPath, operation, use) =>
        harness.contextProvider(repoPath, operation, (value) =>
          use({
            ...value,
            session: {
              ...value.session,
              execute: (run, name, details) =>
                Effect.suspend(() => {
                  const read: Read = { operation: name, columns: [], count: 0 };
                  reads.push(read);
                  if (name === failOperation) return Effect.fail(databaseFailure);
                  return value.session.execute(run, name, details).pipe(
                    Effect.tap((result) =>
                      Effect.sync(() => {
                        if (Array.isArray(result)) {
                          read.columns = result.length > 0 ? Object.keys(result[0]) : [];
                          read.count = result.length;
                        }
                      }),
                    ),
                  );
                }),
            },
          }),
        ),
    });
    return createOdtMcpToolContext({
      browserAgentTools: {
        runAgentTool: () => Effect.die(new Error("Task reads never run browser tools.")),
      },
      browserCallers: {
        resolve: () => Effect.die(new Error("Task reads never resolve a browser caller.")),
      },
      taskService: createTaskService({ taskStore: store }),
      workspaceSettingsService: {
        getRepoConfig: () =>
          Effect.succeed(
            repoConfigSchema.parse({
              workspaceId: "fixture",
              workspaceName: "Fixture",
              repoPath: harness.repoPath,
            }),
          ),
        listWorkspaces: () => Effect.succeed([]),
      },
      taskAssetReadService: {
        readBatch: (input) => {
          expect(input).toEqual({
            workspaceId: "fixture",
            taskId: "repo-0",
            scope: "description",
            assetIds: [assetId],
          });
          return Effect.succeed({
            kind: "available",
            assets: [
              {
                assetId,
                asset: {
                  bytes: Uint8Array.from([1]),
                  mediaType: "image/png",
                  headers: {
                    "Cache-Control": "private, no-store",
                    "Content-Disposition": 'inline; filename="fixture.png"',
                    "Content-Type": "image/png",
                    "X-Content-Type-Options": "nosniff",
                  },
                },
              },
            ],
          });
        },
      },
    });
  }
});

async function seedTasks(harness: SqliteTaskStoreTestHarness): Promise<void> {
  await Effect.runPromise(
    harness.contextProvider(harness.repoPath, "test.seed", ({ session }) =>
      Effect.gen(function* () {
        const rows = Array.from({ length: 32 }, (_, index) =>
          taskRowFixture({
            id: `repo-${index}`,
            title: index === 0 ? "Focused lookup: final result" : `Other task ${index}`,
            description: "x".repeat(2048),
            status: index < 24 ? "closed" : "open",
          }),
        );
        yield* session.execute((db) => db.insert(tasks).values(rows), "test.insertTasks");
        for (const kind of ["spec", "implementation_plan", "qa_report"] as const) {
          for (const revision of [1, 2, 3]) {
            yield* session.execute(
              (db) =>
                db.insert(taskDocuments).values(
                  rows.map((row) => ({
                    taskId: row.id,
                    kind,
                    revision,
                    markdown: `${kind} revision ${revision}`,
                    format: "plain_text" as const,
                    verdict: kind === "qa_report" ? ("approved" as const) : null,
                    updatedAt: row.updatedAt,
                  })),
                ),
              "test.insertDocuments",
            );
          }
        }
      }),
    ),
  );
}
