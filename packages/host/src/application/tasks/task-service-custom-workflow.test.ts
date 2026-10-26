import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { builtinTaskWorkflow } from "@openducktor/workflows";
import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import { Effect } from "effect";
import { z } from "zod";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { reviewTaskWorkflows } from "../../test-support/task-workflows";
import type { WorkflowArtifactSaveInput } from "./task-inputs";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createTaskService,
} from "./test-support/task-workflow-harness";

let harness: SqliteTaskStoreTestHarness;

beforeEach(async () => {
  harness = await createSqliteTaskStoreHarness({ taskWorkflows: reviewTaskWorkflows });
});

afterEach(async () => {
  await harness.cleanup();
});

const service = (taskWorkflows: TaskWorkflowResolver = reviewTaskWorkflows) =>
  createTaskService({
    taskStore: harness.store,
    taskWorkflows,
    gitPort: createBuildStartGitPort({ calls: [] }),
    settingsConfig: createBuildSettingsConfig(new Set([harness.repoPath])),
    systemCommands: createBuildSystemCommands([]),
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "fairnest",
      repoPath: harness.repoPath,
      hooks: { postComplete: [] },
    }),
  });

const createArticle = () =>
  Effect.runPromise(
    service().createTask({
      repoPath: harness.repoPath,
      task: { title: "Launch post", issueType: "article", priority: 2 },
    }),
  );

const save = (taskId: string, code: string, updatedBy: string, verdict?: string) => {
  const input: WorkflowArtifactSaveInput = {
    repoPath: harness.repoPath,
    taskId,
    code,
    markdown: `# ${code} by ${updatedBy}`,
    submit: true,
    sourceTool: "odt_set_task_artifact",
    updatedBy,
  };
  if (verdict !== undefined) input.verdict = verdict;
  return Effect.runPromise(service().workflowArtifactSave(input));
};

const status = async (taskId: string): Promise<string | undefined> => {
  const card = await Effect.runPromise(service().findTask({ repoPath: harness.repoPath, taskId }));
  return card?.status;
};

const artifactRowsSchema = z.array(
  z.object({
    artifact_id: z.string(),
    code: z.string(),
    revision: z.number(),
    verdict: z.string().nullable(),
    source_tool: z.string(),
    updated_by: z.string(),
  }),
);

const readArtifactRows = (taskId: string) => {
  const database = new Database(harness.databasePath, { readonly: true });
  const statement = database.prepare(
    "select artifact_id, code, revision, verdict, source_tool, updated_by from tasks_artifacts where task_id = ? and classification = 'workflow' order by code, revision",
  );
  try {
    return artifactRowsSchema.parse(statement.all(taskId));
  } finally {
    // An open statement keeps the file open, and Windows then cannot remove the test directory.
    statement.finalize();
    database.close();
  }
};

describe("task service with a custom task workflow", () => {
  test("creates a task in the initial state with the roles and artifacts of its workflow", async () => {
    const card = await createArticle();

    expect(card.status).toBe("backlog");
    expect(card.issueType).toBe("article");
    expect(Object.keys(card.agentWorkflows)).toEqual(["writer", "editor"]);
    expect(Object.keys(card.artifactSummary)).toEqual(["draft", "review"]);
    expect(card.availableActions).toContain("start_write");
  });

  test("rejects an issue type that the workflow does not declare", async () => {
    const result = await Effect.runPromiseExit(
      service().createTask({
        repoPath: harness.repoPath,
        task: { title: "Bug", issueType: "bug", priority: 2 },
      }),
    );

    expect(String(result)).toContain("article");
  });

  test("moves a task with status events, artifact saves, and review verdicts", async () => {
    const { id } = await createArticle();

    await Effect.runPromise(
      service().transitionTask({ repoPath: harness.repoPath, taskId: id, status: "writing" }),
    );
    expect(await status(id)).toBe("writing");

    await save(id, "draft", "writer");
    expect(await status(id)).toBe("reviewing");
    await save(id, "review", "editor", "revise");
    expect(await status(id)).toBe("writing");
    await save(id, "draft", "writer");
    await save(id, "review", "editor", "accept");
    expect(await status(id)).toBe("approval");

    const row = (code: string, revision: number, updatedBy: string, verdict: string | null) => ({
      artifact_id: `workflow:${id}:${code}`,
      code,
      revision,
      verdict,
      source_tool: "odt_set_task_artifact",
      updated_by: updatedBy,
    });
    expect(readArtifactRows(id)).toEqual([
      row("draft", 1, "writer", null),
      row("draft", 2, "writer", null),
      row("review", 1, "editor", "revise"),
      row("review", 2, "editor", "accept"),
    ]);
    const card = await Effect.runPromise(
      service().findTask({ repoPath: harness.repoPath, taskId: id }),
    );
    expect(card?.artifactSummary.review).toMatchObject({ present: true, verdict: "accept" });
  });

  test("rejects a verdict that the review artifact does not declare", async () => {
    const { id } = await createArticle();

    const result = await Effect.runPromiseExit(
      service().workflowArtifactSave({
        repoPath: harness.repoPath,
        taskId: id,
        code: "review",
        markdown: "# Review",
        submit: true,
        verdict: "approved",
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
      }),
    );

    expect(String(result)).toContain("accept or revise");
    expect(readArtifactRows(id)).toEqual([]);
  });

  test("applies an event action without a host effect", async () => {
    const { id } = await createArticle();
    await Effect.runPromise(
      service().transitionTask({ repoPath: harness.repoPath, taskId: id, status: "writing" }),
    );
    await save(id, "draft", "writer");
    await save(id, "review", "editor", "accept");

    const card = await Effect.runPromise(
      service().applyTaskEvent({ repoPath: harness.repoPath, taskId: id, eventId: "hold" }),
    );

    expect(card.status).toBe("paused");
  });

  test("rejects an event whose action is not available for the task", async () => {
    const { id } = await createArticle();
    await Effect.runPromise(
      service().transitionTask({ repoPath: harness.repoPath, taskId: id, status: "writing" }),
    );
    await save(id, "draft", "writer");

    const result = await Effect.runPromiseExit(
      service().applyTaskEvent({ repoPath: harness.repoPath, taskId: id, eventId: "hold" }),
    );

    expect(String(result)).toContain("No action that sends hold is available");
    expect(await status(id)).toBe("reviewing");
  });

  test.each([
    ["approve-copy", "review.approve host effect"],
    ["move-writing", "not sent by an event action"],
    ["missing", "not sent by an event action"],
  ])("rejects event %s through the event command", async (eventId, message) => {
    const { id } = await createArticle();

    const result = await Effect.runPromiseExit(
      service().applyTaskEvent({ repoPath: harness.repoPath, taskId: id, eventId }),
    );

    expect(String(result)).toContain(message);
    expect(await status(id)).toBe("backlog");
  });

  test("pauses, resumes, and completes a build with the effect events of the workflow", async () => {
    const { id } = await createArticle();
    const input = { repoPath: harness.repoPath, taskId: id };
    await Effect.runPromise(service().transitionTask({ ...input, status: "writing" }));

    await Effect.runPromise(service().buildBlocked({ ...input, reason: "Waiting for data" }));
    expect(await status(id)).toBe("paused");
    await Effect.runPromise(service().buildResumed(input));
    expect(await status(id)).toBe("writing");

    const denied = await Effect.runPromiseExit(service().buildCompleted(input));
    expect(String(denied)).toContain("Save the draft first");

    await Effect.runPromise(
      service().workflowArtifactSave({
        ...input,
        code: "draft",
        markdown: "# Draft",
        submit: false,
        sourceTool: "odt_set_task_artifact",
        updatedBy: "writer",
      }),
    );
    expect(await status(id)).toBe("writing");
    await Effect.runPromise(service().buildCompleted(input));
    expect(await status(id)).toBe("reviewing");
  });

  test("approves and rejects a reviewed task with the review effect events", async () => {
    const { id } = await createArticle();
    const input = { repoPath: harness.repoPath, taskId: id };
    await Effect.runPromise(service().transitionTask({ ...input, status: "writing" }));
    await save(id, "draft", "writer");
    await save(id, "review", "editor", "accept");

    await Effect.runPromise(service().humanRequestChanges({ ...input, note: "Shorter intro" }));
    expect(await status(id)).toBe("writing");

    await save(id, "draft", "writer");
    await save(id, "review", "editor", "accept");
    await Effect.runPromise(service().humanApprove(input));
    expect(await status(id)).toBe("published");
  });

  test("closes a task into its terminal close state and resets it to the initial state", async () => {
    const first = await createArticle();
    const second = await createArticle();

    const closed = await Effect.runPromise(
      service().closeTask({ repoPath: harness.repoPath, taskId: first.id }),
    );
    expect(closed.status).toBe("shelved");

    const input = { repoPath: harness.repoPath, taskId: second.id };
    await Effect.runPromise(service().transitionTask({ ...input, status: "writing" }));
    await save(second.id, "draft", "writer");
    const reset = await Effect.runPromise(service().resetTask(input));
    expect(reset.status).toBe("backlog");
    expect(reset.artifactSummary.draft).toEqual({ present: false });
  });

  test("commits the start event of a role step and rejects other events", async () => {
    const { id } = await createArticle();
    const input = { repoPath: harness.repoPath, taskId: id };

    const rejected = await Effect.runPromiseExit(
      service().applyStartEvent({ ...input, eventId: "move-writing" }),
    );
    expect(String(rejected)).toContain("starts no step");
    expect(await status(id)).toBe("backlog");

    const started = await Effect.runPromise(
      service().applyStartEvent({ ...input, eventId: "start-writing" }),
    );
    expect(started.status).toBe("writing");
  });
});

describe("task service with a workflow for each task", () => {
  test("reads, moves, and hides each task with the workflow of that task", async () => {
    const review = createReviewTaskWorkflow();
    // The issue type stands for the stored workflow of a task.
    const taskWorkflows: TaskWorkflowResolver = {
      forTask: (task: { readonly id: string; readonly issueType?: string }) =>
        task.issueType === "article" ? review : builtinTaskWorkflow,
      forNewTask: () => builtinTaskWorkflow,
      workflows: [builtinTaskWorkflow, review],
    };
    await harness.cleanup();
    harness = await createSqliteTaskStoreHarness({ taskWorkflows });
    const tasks = service(taskWorkflows);
    const insert = (issueType: string, status: string) =>
      Effect.runPromise(
        harness.store.createTask({
          repoPath: harness.repoPath,
          task: { title: issueType, issueType, priority: 2 },
          status,
        }),
      );
    const article = await insert("article", "backlog");
    const feature = await insert("feature", "open");

    const cards = await Effect.runPromise(tasks.listTasks({ repoPath: harness.repoPath }));
    const card = (id: string) => cards.find((entry) => entry.id === id);
    expect(Object.keys(card(article.id)?.agentWorkflows ?? {})).toEqual(["writer", "editor"]);
    expect(Object.keys(card(article.id)?.artifactSummary ?? {})).toEqual(["draft", "review"]);
    expect(Object.keys(card(feature.id)?.artifactSummary ?? {})).toEqual([
      "spec",
      "plan",
      "qaReport",
    ]);

    const input = (taskId: string) => ({ repoPath: harness.repoPath, taskId });
    const moved = await Effect.runPromise(
      tasks.transitionTask({ ...input(article.id), status: "writing" }),
    );
    expect(moved.status).toBe("writing");
    const rejected = await Effect.runPromiseExit(
      tasks.transitionTask({ ...input(feature.id), status: "writing" }),
    );
    expect(String(rejected)).toContain("task_transition cannot move tasks to writing");

    await Effect.runPromise(tasks.closeTask(input(article.id)));
    await Effect.runPromise(tasks.closeTask(input(feature.id)));
    expect((await Effect.runPromise(tasks.findTask(input(article.id))))?.status).toBe("shelved");
    expect((await Effect.runPromise(tasks.findTask(input(feature.id))))?.status).toBe("closed");
    const visible = await Effect.runPromise(
      harness.store.listTasks({ repoPath: harness.repoPath, doneVisibleDays: 0 }),
    );
    expect(visible).toEqual([]);
  });
});
