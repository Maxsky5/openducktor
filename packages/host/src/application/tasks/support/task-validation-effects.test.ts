import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskPolicyError } from "../../../domain/task";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import { validatePullRequestManagementStatusEffect } from "./task-validation-effects";
import { blockBuildCompletionTask } from "./task-workflow-helpers";

const task = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 1,
  issueType: "feature",
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  availableActions: [],
  agentWorkflows: {
    spec: { required: true, canSkip: false, available: true, completed: false },
    planner: { required: true, canSkip: false, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  aiReviewEnabled: false,
  updatedAt: "2026-05-10T10:00:00.000Z",
  createdAt: "2026-05-10T09:00:00.000Z",
  ...overrides,
});

describe("task validation effects", () => {
  test("preserves task policy errors from pull request management validation", async () => {
    const error = await Effect.runPromise(
      Effect.flip(validatePullRequestManagementStatusEffect("open")),
    );

    expect(error).toBeInstanceOf(TaskPolicyError);
    expect((error as TaskPolicyError).code).toBe("TASK_POLICY_ERROR");
  });

  test("blockBuildCompletionTask preserves transition policy errors", async () => {
    const current = task({ issueType: "bug", status: "human_review" });
    const taskStore = {
      transitionTask() {
        return Effect.die("transition should not run");
      },
    } as unknown as TaskStorePort;

    const error = await Effect.runPromise(
      Effect.flip(blockBuildCompletionTask(taskStore, "/repo", current.id, current, [current])),
    );

    expect(error).toBeInstanceOf(TaskPolicyError);
    expect((error as TaskPolicyError).code).toBe("TASK_TRANSITION_NOT_ALLOWED");
  });
});
