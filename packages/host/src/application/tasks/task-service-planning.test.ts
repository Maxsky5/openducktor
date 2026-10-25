import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { Effect } from "effect";
import { createTaskService, type TaskStorePort, task } from "./test-support/task-workflow-harness";

const savedArtifact = { markdown: "# Saved", updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 };

/** A store that records saves and transitions of one task. */
const recordingStore = (current: ReturnType<typeof task>, calls: unknown[]): TaskStorePort => ({
  getTask: (input) => Effect.sync(() => (calls.push({ type: "get", input }), current)),
  saveWorkflowArtifact: (input) =>
    Effect.sync(() => {
      calls.push({ type: "save", input });
      return { task: current, artifact: { ...savedArtifact, markdown: input.markdown } };
    }),
  transitionTask: (input) =>
    Effect.sync(() => {
      calls.push({ type: "transition", input });
      return { ...current, status: input.status };
    }),
});

describe("createTaskService workflow artifact saves", () => {
  test("submits a spec with the status and signal of its save event in one store write", async () => {
    const calls: unknown[] = [];
    const current = task({ id: "task-1", status: "open", issueType: "feature" });
    const saved = await Effect.runPromise(
      createTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskStore: recordingStore(current, calls),
      }).workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath: "/repo",
        taskId: "task-1",
        code: "spec",
        markdown: "# Spec",
        submit: true,
      }),
    );

    expect(saved).toEqual({
      artifact: { ...savedArtifact, markdown: "# Spec" },
      changes: { taskIds: ["task-1"], removedTaskIds: [] },
    });
    expect(calls).toEqual([
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "save",
        input: {
          repoPath: "/repo",
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          taskId: "task-1",
          code: "spec",
          markdown: "# Spec",
          status: "spec_ready",
          cause: { signal: "taskProgressedToSpecReady" },
        },
      },
    ]);
  });

  test("saves a document draft without a workflow event", async () => {
    const calls: unknown[] = [];
    const current = task({ id: "task-1", status: "in_progress" });
    await Effect.runPromise(
      createTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskStore: recordingStore(current, calls),
      }).workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath: "/repo",
        taskId: "task-1",
        code: "plan",
        markdown: "# Plan",
        submit: false,
      }),
    );

    expect(calls).toEqual([
      {
        type: "save",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          code: "plan",
          markdown: "# Plan",
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
        },
      },
    ]);
  });

  test.each([
    {
      start: "ai_review",
      verdict: "approved",
      status: "human_review",
      cause: { signal: "taskProgressedToHumanReview", sourceRole: "qa" },
    },
    {
      start: "blocked",
      verdict: "approved",
      status: "human_review",
      cause: { signal: "taskProgressedToHumanReview", sourceRole: "qa" },
    },
    {
      start: "human_review",
      verdict: "rejected",
      status: "in_progress",
      cause: { signal: "taskRejectedByQa" },
    },
    {
      start: "blocked",
      verdict: "rejected",
      status: "in_progress",
      cause: { signal: "taskRejectedByQa" },
    },
  ] as const)(
    "commits a $verdict review from $start with its event status and signal",
    async ({ start, verdict, status, cause }) => {
      const calls: unknown[] = [];
      const current = task({ id: "task-1", status: start });
      await Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          taskStore: recordingStore(current, calls),
        }).workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath: "/repo",
          taskId: "task-1",
          code: "qaReport",
          markdown: "# Report",
          verdict,
          submit: true,
        }),
      );

      expect(calls).toEqual([
        { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
        {
          type: "save",
          input: {
            repoPath: "/repo",
            sourceTool: "workflow_artifact_save",
            updatedBy: "user",
            taskId: "task-1",
            code: "qaReport",
            markdown: "# Report",
            verdict,
            status,
            cause,
          },
        },
      ]);
    },
  );

  test.each([
    {
      name: "an unknown code",
      input: { code: "notes", submit: true },
      message: "Unknown workflow artifact notes. Use one of spec, plan, qaReport.",
    },
    {
      name: "a document verdict",
      input: { code: "spec", verdict: "approved", submit: true },
      message: "Specification has no verdicts. Save it without a verdict.",
    },
    {
      name: "a review without a verdict",
      input: { code: "qaReport", submit: true },
      message: "Submit the QA Report with one verdict: approved or rejected.",
    },
    {
      name: "a review draft",
      input: { code: "qaReport", verdict: "approved", submit: false },
      message: "Submit the QA Report with one verdict: approved or rejected.",
    },
  ])("rejects $name before a store write", async ({ input, message }) => {
    const calls: unknown[] = [];
    const error = await Effect.runPromise(
      createTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskStore: recordingStore(task({ id: "task-1", status: "ai_review" }), calls),
      })
        .workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath: "/repo",
          taskId: "task-1",
          markdown: "# Text",
          ...input,
        })
        .pipe(Effect.flip),
    );

    expect(error.message).toBe(message);
    expect(calls).toEqual([]);
  });

  test("rejects a submit that its event does not admit, before a store write", async () => {
    const calls: unknown[] = [];
    const error = await Effect.runPromise(
      createTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskStore: recordingStore(task({ id: "task-1", status: "open" }), calls),
      })
        .workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath: "/repo",
          taskId: "task-1",
          code: "qaReport",
          markdown: "# Report",
          verdict: "approved",
          submit: true,
        })
        .pipe(Effect.flip),
    );

    expect(error.message).toBe(
      "Saving the QA Report is only allowed from blocked, ai_review, or human_review (current: open).",
    );
    expect(calls).toEqual([{ type: "get", input: { repoPath: "/repo", taskId: "task-1" } }]);
  });
});
