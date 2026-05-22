import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { deriveAgentWorkflows, deriveAvailableActions, validateTransition } from "./index";

const task = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  notes: "",
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

    expect(() => validateTransition(epic, [epic, subtask], "human_review", "closed")).toThrow(
      "Epic cannot be completed",
    );
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

  test("derives human approval only when closing policy allows it", () => {
    const reviewTask = task({ status: "human_review" });

    expect(deriveAvailableActions(reviewTask, [reviewTask])).toContain("human_approve");
  });
});
