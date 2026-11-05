import { specPlanBuildWorkflow } from "@openducktor/workflows";
import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { Effect, Result } from "effect";
import { TaskPolicyError } from "../../../domain/task";
import { singleTaskWorkflow } from "../../../test-support/task-workflows";
import { HostValidationError } from "../../../effect/host-errors";
import {
  coreTaskTransition,
  decideCoreTaskAction,
  formatStatusList,
  requireApprovalAvailable,
  requirePullRequestManagement,
  requireTaskEvent,
  requireTaskEventInput,
  startWorktreeSessionHint,
} from "./task-workflow-events";

const task = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 1,
  issueType: "feature",
  removeWorktreeOnClose: null,
  labels: [],
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  workflow: { id: "openducktor-spec-plan-build", revision: 2 },
  workflowSteps: [],
  availableActions: [],
  agentWorkflows: {
    spec: { required: true, canSkip: false, available: true, completed: false },
    planner: { required: true, canSkip: false, available: false, completed: false },
    build: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-05-10T10:00:00.000Z",
  createdAt: "2026-05-10T09:00:00.000Z",
  ...overrides,
});

const policyError = async (effect: Effect.Effect<unknown, unknown>) => {
  const error = await Effect.runPromise(Effect.flip(effect));
  expect(error).toBeInstanceOf(TaskPolicyError);
  if (!(error instanceof TaskPolicyError)) throw error;
  return error;
};

describe("task workflow events", () => {
  test("maps a status denial to a transition error with the allowed statuses", async () => {
    const error = await policyError(
      requireTaskEvent(specPlanBuildWorkflow, "human-request-changes", task({ status: "blocked" })),
    );
    expect(error.code).toBe("TASK_TRANSITION_NOT_ALLOWED");
    expect(error.message).toBe(
      "human-request-changes is not allowed for task task-1 (feature) from blocked. Use it from in_progress, ai_review, or human_review.",
    );
  });

  test("maps missing planning to a transition error", async () => {
    const error = await policyError(
      requireTaskEvent(specPlanBuildWorkflow, "build-resumed", task()),
    );
    expect(error.code).toBe("TASK_TRANSITION_NOT_ALLOWED");
    expect(error.message).toBe(
      "build-resumed is not allowed for task task-1 (feature) from open. Complete required planning first, then use it from ready_for_dev, in_progress, blocked, ai_review, or human_review.",
    );
  });

  test("returns admitted decisions for transitions and repeats", async () => {
    expect(
      await Effect.runPromise(
        requireTaskEvent(specPlanBuildWorkflow, "build-blocked", task({ status: "blocked" })),
      ),
    ).toEqual({
      kind: "unchanged",
      status: "blocked",
    });
    expect(
      await Effect.runPromise(
        requireTaskEvent(specPlanBuildWorkflow, "build-blocked", task({ status: "in_progress" })),
      ),
    ).toEqual({ kind: "transition", from: "in_progress", to: "blocked", cause: {} });
  });

  test("reports status denials of validation commands with their allowed statuses", async () => {
    const current = task({ status: "closed" });
    const error = await Effect.runPromise(
      Effect.flip(
        requireTaskEventInput(
          "Implementation reset is",
          specPlanBuildWorkflow,
          "reset-implementation",
          current,
          { taskId: current.id },
        ),
      ),
    );
    expect(error).toBeInstanceOf(HostValidationError);
    expect(error.message).toBe(
      "Implementation reset is only allowed from in_progress, blocked, ai_review, or human_review (current: closed).",
    );
  });

  test("reports guard denials of validation commands with the guard message", async () => {
    const current = task();
    const error = await Effect.runPromise(
      Effect.flip(
        requireTaskEventInput("Build resume is", specPlanBuildWorkflow, "build-resumed", current, {
          taskId: current.id,
        }),
      ),
    );
    expect(error.message).toBe(
      "Build resume is not allowed yet. Complete required planning first.",
    );
  });

  test.each(["open", "in_progress", "ai_review", "human_review"])(
    "allows pull request management in %s without a workflow event",
    async (status) => {
      await Effect.runPromise(requirePullRequestManagement(task({ status })));
    },
  );

  test("rejects pull request management of a closed task", async () => {
    const error = await policyError(requirePullRequestManagement(task({ status: "closed" })));
    expect(error.code).toBe("TASK_POLICY_ERROR");
    expect(error.message).toBe(
      "Task task-1 is closed, so its pull request cannot change. Manage pull requests only for a task that is not closed.",
    );
  });

  test("allows approval when the approval action of the workflow is available", async () => {
    await Effect.runPromise(
      requireApprovalAvailable(specPlanBuildWorkflow, task({ status: "ai_review" })),
    );
    const error = await Effect.runPromise(
      Effect.flip(requireApprovalAvailable(specPlanBuildWorkflow, task({ status: "in_progress" }))),
    );
    expect(error.message).toBe("Human approval is only allowed from ai_review or human_review.");
    const review = createReviewTaskWorkflow();
    const reviewTask = (status: string) =>
      task({ status, workflow: review.reference, artifactSummary: review.emptyArtifactSummary() });
    await Effect.runPromise(requireApprovalAvailable(review, reviewTask("approval")));
    const closed = await Effect.runPromise(
      Effect.flip(requireApprovalAvailable(review, reviewTask("closed"))),
    );
    expect(closed.message).toBe("Human approval is only allowed from approval.");
  });

  test("formats status lists for messages", () => {
    expect(formatStatusList(["open"])).toBe("open");
    expect(formatStatusList(["ai_review", "human_review"])).toBe("ai_review or human_review");
    expect(formatStatusList(["open", "blocked", "closed"])).toBe("open, blocked, or closed");
  });

  test("names the worktree roles of the task workflow", () => {
    expect(startWorktreeSessionHint(specPlanBuildWorkflow)).toBe(
      "Start a Builder or QA session first.",
    );
    expect(startWorktreeSessionHint(createReviewTaskWorkflow())).toBe(
      "Start a Writer session first.",
    );
  });
});

describe("core task actions", () => {
  const review = createReviewTaskWorkflow();
  const reviewTask = (status: string) =>
    task({ status, workflow: review.reference, artifactSummary: review.emptyArtifactSummary() });

  test.each(["open", "writing", "reviewing", "approval"])(
    "closes a task in %s without a workflow event",
    (status) => {
      expect(Result.getOrThrow(decideCoreTaskAction("close", reviewTask(status)))).toEqual({
        kind: "transition",
        from: status,
        to: "closed",
        cause: {},
      });
    },
  );

  test("keeps a closed task closed", () => {
    expect(Result.getOrThrow(decideCoreTaskAction("close", reviewTask("closed")))).toEqual({
      kind: "unchanged",
      status: "closed",
    });
  });

  test.each(["writing", "paused", "approval"])("resets a task in %s to open", (status) => {
    expect(
      Result.getOrThrow(
        coreTaskTransition(singleTaskWorkflow(review), "reset")(reviewTask(status)),
      ),
    ).toEqual({ status: "open", cause: {}, workflowId: "review" });
  });

  test("keeps an open task open on reset and rejects a reset of a closed task", () => {
    expect(Result.getOrThrow(decideCoreTaskAction("reset", reviewTask("open")))).toEqual({
      kind: "unchanged",
      status: "open",
    });
    const denied = decideCoreTaskAction("reset", reviewTask("closed"));
    expect(Result.isFailure(denied)).toBe(true);
    if (Result.isFailure(denied)) {
      expect(denied.failure).toBeInstanceOf(HostValidationError);
      expect(denied.failure.message).toBe(
        "Task task-1 is closed, so it cannot reset. Reset only a task that is not closed.",
      );
    }
  });
});
