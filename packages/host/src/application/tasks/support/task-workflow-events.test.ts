import { builtinTaskWorkflow } from "@openducktor/workflows";
import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskPolicyError } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import {
  formatStatusList,
  requirePullRequestManagement,
  requireTaskEvent,
  requireTaskEventInput,
} from "./task-workflow-events";
import { blockBuildCompletionTask } from "./task-workflow-helpers";

const task = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 1,
  issueType: "feature",
  labels: [],
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
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
      requireTaskEvent(builtinTaskWorkflow, "human-request-changes", task({ status: "blocked" })),
    );
    expect(error.code).toBe("TASK_TRANSITION_NOT_ALLOWED");
    expect(error.message).toBe(
      "human-request-changes is not allowed for task task-1 (feature) from blocked. Use it from in_progress, ai_review, or human_review.",
    );
  });

  test("maps missing planning to a transition error", async () => {
    const error = await policyError(requireTaskEvent(builtinTaskWorkflow, "build-resumed", task()));
    expect(error.code).toBe("TASK_TRANSITION_NOT_ALLOWED");
    expect(error.message).toBe(
      "build-resumed is not allowed for task task-1 (feature) from open. Complete required planning first, then use it from ready_for_dev, in_progress, blocked, ai_review, or human_review.",
    );
  });

  test("returns admitted decisions for transitions and repeats", async () => {
    expect(
      await Effect.runPromise(
        requireTaskEvent(builtinTaskWorkflow, "build-blocked", task({ status: "blocked" })),
      ),
    ).toEqual({
      kind: "unchanged",
      status: "blocked",
    });
    expect(
      await Effect.runPromise(
        requireTaskEvent(builtinTaskWorkflow, "build-blocked", task({ status: "in_progress" })),
      ),
    ).toEqual({ kind: "transition", from: "in_progress", to: "blocked", cause: {} });
  });

  test("reports status denials of validation commands with their allowed statuses", async () => {
    const current = task({ status: "closed" });
    const error = await Effect.runPromise(
      Effect.flip(
        requireTaskEventInput("Task reset is", builtinTaskWorkflow, "reset-task", current, {
          taskId: current.id,
        }),
      ),
    );
    expect(error).toBeInstanceOf(HostValidationError);
    expect(error.message).toBe(
      "Task reset is only allowed from open, spec_ready, ready_for_dev, in_progress, blocked, ai_review, or human_review (current: closed).",
    );
  });

  test("reports guard denials of validation commands with the guard message", async () => {
    const current = task();
    const error = await Effect.runPromise(
      Effect.flip(
        requireTaskEventInput("Build resume is", builtinTaskWorkflow, "build-resumed", current, {
          taskId: current.id,
        }),
      ),
    );
    expect(error.message).toBe(
      "Build resume is not allowed yet. Complete required planning first.",
    );
  });

  test("keeps pull request management to its workflow statuses", async () => {
    const error = await policyError(requirePullRequestManagement(builtinTaskWorkflow, task()));
    expect(error.code).toBe("TASK_POLICY_ERROR");
    expect(error.message).toBe(
      "Pull request management is only available from in_progress, ai_review, or human_review.",
    );
    await Effect.runPromise(
      requirePullRequestManagement(builtinTaskWorkflow, task({ status: "ai_review" })),
    );
  });

  test("formats status lists for messages", () => {
    expect(formatStatusList(["open"])).toBe("open");
    expect(formatStatusList(["ai_review", "human_review"])).toBe("ai_review or human_review");
    expect(formatStatusList(["open", "blocked", "closed"])).toBe("open, blocked, or closed");
  });

  test("blockBuildCompletionTask preserves transition policy errors", async () => {
    const current = task({ issueType: "bug", status: "closed" });
    const taskStore = {
      transitionTask() {
        return Effect.die("transition should not run");
      },
    } satisfies Pick<TaskStorePort, "transitionTask">;

    const error = await Effect.runPromise(
      Effect.flip(
        blockBuildCompletionTask(taskStore, builtinTaskWorkflow, "/repo", current.id, current),
      ),
    );

    expect(error).toBeInstanceOf(TaskPolicyError);
    if (!(error instanceof TaskPolicyError)) throw error;
    expect(error.code).toBe("TASK_TRANSITION_NOT_ALLOWED");
  });
});
