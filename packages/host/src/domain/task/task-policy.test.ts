import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import {
  deriveAgentWorkflows,
  deriveAvailableActions,
  TaskPolicyError,
  validateManualCloseTask,
  validateTransition,
} from "./index";

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

describe("task domain policy", () => {
  test("blocks feature work from starting before planning", () => {
    expect(() => validateTransition(task(), [task()], "open", "in_progress")).toThrow(
      "Transition not allowed",
    );
  });

  test("reports disallowed transitions with a stable policy code", () => {
    try {
      validateTransition(
        task({ status: "human_review" }),
        [task({ status: "human_review" })],
        "human_review",
        "blocked",
      );
      throw new Error("Expected transition validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskPolicyError);
      expect((error as TaskPolicyError).code).toBe("TASK_TRANSITION_NOT_ALLOWED");
      expect((error as Error).message).toContain("human_review -> blocked");
    }
  });

  test("allows task issue types to skip spec and planning", () => {
    const workItem = task({ issueType: "task" });

    expect(() => validateTransition(workItem, [workItem], "open", "in_progress")).not.toThrow();
  });

  test("keeps epic completion blocked while direct subtasks are active", () => {
    const epic = task({ id: "epic-1", issueType: "epic", status: "human_review" });
    const subtask = task({
      id: "task-2",
      issueType: "task",
      parentId: epic.id,
      status: "in_progress",
    });

    try {
      validateTransition(epic, [epic, subtask], "human_review", "closed");
      throw new Error("Expected epic completion validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskPolicyError);
      expect((error as TaskPolicyError).code).toBe("TASK_POLICY_ERROR");
      expect((error as Error).message).toContain("Epic cannot be completed");
    }
  });

  test("derives role workflows from task type, status, and documents", () => {
    const workflows = deriveAgentWorkflows(
      task({
        status: "ready_for_dev",
        documentSummary: {
          spec: { has: true },
          plan: { has: true },
          qaReport: { has: false, verdict: "not_reviewed" },
        },
      }),
    );

    expect(workflows.spec.completed).toBe(true);
    expect(workflows.planner.completed).toBe(true);
    expect(workflows.builder.available).toBe(true);
  });

  test("keeps QA available while a build is blocked", () => {
    const blockedTask = task({
      status: "blocked",
      aiReviewEnabled: true,
    });
    const workflows = deriveAgentWorkflows(blockedTask);
    const actions = deriveAvailableActions(blockedTask, [blockedTask]);

    expect(workflows.qa.available).toBe(true);
    expect(actions).toContain("qa_start");
  });

  test("keeps rework build action for blocked QA-rejected tasks", () => {
    const blockedTask = task({
      status: "blocked",
      aiReviewEnabled: true,
      documentSummary: {
        spec: { has: false },
        plan: { has: false },
        qaReport: { has: true, verdict: "rejected" },
      },
    });
    const actions = deriveAvailableActions(blockedTask, [blockedTask]);

    expect(actions).toContain("qa_start");
    expect(actions).toContain("build_start");
    expect(actions).toContain("open_qa");
  });

  test("keeps QA unavailable outside QA workflow statuses", () => {
    for (const status of ["ready_for_dev", "in_progress"] as const) {
      const workItem = task({
        status,
        aiReviewEnabled: true,
      });
      const workflows = deriveAgentWorkflows(workItem);
      const actions = deriveAvailableActions(workItem, [workItem]);

      expect(workflows.qa.available).toBe(false);
      expect(actions).not.toContain("qa_start");
    }
  });

  test("derives human approval only when closing policy allows it", () => {
    const reviewTask = task({ status: "human_review" });

    expect(deriveAvailableActions(reviewTask, [reviewTask])).toContain("human_approve");
  });

  test("derives manual close for every non-closed task status", () => {
    const nonClosedStatuses = [
      "open",
      "spec_ready",
      "ready_for_dev",
      "in_progress",
      "blocked",
      "ai_review",
      "human_review",
    ] as const;

    for (const status of nonClosedStatuses) {
      const workItem = task({ status });

      expect(deriveAvailableActions(workItem, [workItem])).toContain("close_task");
    }
  });

  test("does not derive manual close for closed tasks", () => {
    const closedTask = task({ status: "closed" });

    expect(deriveAvailableActions(closedTask, [closedTask])).not.toContain("close_task");
  });

  test("keeps human approval review-only while manual close supports early states", () => {
    const openTask = task({ status: "open" });

    expect(deriveAvailableActions(openTask, [openTask])).toContain("close_task");
    expect(deriveAvailableActions(openTask, [openTask])).not.toContain("human_approve");
    expect(() => validateTransition(openTask, [openTask], "open", "closed")).toThrow(
      "Transition not allowed",
    );
    expect(() => validateManualCloseTask(openTask, [openTask])).not.toThrow();
  });

  test("keeps manual close blocked for epics with active direct subtasks", () => {
    const epic = task({ id: "epic-1", issueType: "epic", status: "ready_for_dev" });
    const activeSubtask = task({
      id: "task-2",
      issueType: "task",
      parentId: epic.id,
      status: "blocked",
    });

    expect(deriveAvailableActions(epic, [epic, activeSubtask])).not.toContain("close_task");
    expect(() => validateManualCloseTask(epic, [epic, activeSubtask])).toThrow(
      "Epic cannot be completed",
    );
  });

  test("allows manual close for epics with closed direct subtasks", () => {
    const epic = task({ id: "epic-1", issueType: "epic", status: "ready_for_dev" });
    const closedSubtask = task({
      id: "task-2",
      issueType: "task",
      parentId: epic.id,
      status: "closed",
    });

    expect(deriveAvailableActions(epic, [epic, closedSubtask])).toContain("close_task");
    expect(() => validateManualCloseTask(epic, [epic, closedSubtask])).not.toThrow();
  });
});
