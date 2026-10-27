import { describe, expect, test } from "bun:test";

import {
  resolveTaskCardActions,
  taskActionLabel,
  type TaskWorkflowAction,
} from "./presentation-actions";
import { deriveTaskProjection } from "./task-projection";
import { createTaskCardFixture } from "../../test-support/task-card-fixture";

const CARD_ACTIONS: readonly TaskWorkflowAction[] = [
  "set_spec",
  "set_plan",
  "open_spec",
  "open_planner",
  "qa_start",
  "build_start",
  "open_builder",
  "open_qa",
  "human_approve",
  "human_request_changes",
  "reset_implementation",
];

describe("resolveTaskCardActions", () => {
  test("keeps board availability separate from Studio role reruns", () => {
    const task = createTaskCardFixture({
      status: "open",
      issueType: "feature",
      availableActions: ["set_spec"],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: false, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: false },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
    });

    expect(resolveTaskCardActions(task).allActions).toEqual(["set_spec"]);
    expect(
      resolveTaskCardActions(task, { surface: "agent_studio_quick_actions" }).allActions,
    ).toEqual(["set_spec", "build_start"]);
  });

  test("prioritizes planner action over continue spec when task is spec_ready", () => {
    const task = createTaskCardFixture({
      status: "spec_ready",
      issueType: "feature",
      availableActions: ["set_spec", "set_plan"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("set_plan");
    expect(result.secondaryActions).toContain("set_spec");
  });

  test("keeps spec action priority before planner when task is not spec_ready", () => {
    const task = createTaskCardFixture({
      status: "open",
      issueType: "feature",
      availableActions: ["set_spec", "set_plan"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("set_spec");
  });

  test("keeps build-first priority for bug workflow actions", () => {
    const task = createTaskCardFixture({
      status: "open",
      issueType: "bug",
      availableActions: ["set_plan", "build_start"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("build_start");
  });

  test("uses build_start as primary for feature-ready-for-dev tasks", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      issueType: "feature",
      availableActions: ["set_spec", "set_plan", "build_start"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("build_start");
  });

  test("uses build_start as primary for ready-for-dev features", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      issueType: "feature",
      availableActions: ["set_spec", "set_plan", "build_start"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("build_start");
  });

  test("uses build_start as primary for task-ready-for-dev tasks", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      issueType: "task",
      availableActions: ["set_spec", "set_plan", "build_start"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("build_start");
  });

  test("uses open_builder for in-progress tasks when resume is not available", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      issueType: "feature",
      availableActions: ["set_plan", "build_start", "open_builder", "reset_implementation"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("open_builder");
    expect(result.secondaryActions).toContain("reset_implementation");
  });

  test("keeps reset implementation available for blocked tasks", () => {
    const task = createTaskCardFixture({
      status: "blocked",
      issueType: "task",
      availableActions: ["open_builder", "reset_implementation"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("open_builder");
    expect(result.secondaryActions).toEqual(["reset_implementation"]);
  });

  test("uses qa_start as primary during ai review when available", () => {
    const task = createTaskCardFixture({
      status: "ai_review",
      issueType: "feature",
      availableActions: [
        "open_builder",
        "qa_start",
        "human_request_changes",
        "human_approve",
        "reset_implementation",
      ],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("qa_start");
    expect(result.secondaryActions).toEqual([
      "human_approve",
      "human_request_changes",
      "open_builder",
      "reset_implementation",
    ]);
  });

  test("uses build_start as primary for qa rejected in-progress tasks", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      issueType: "task",
      availableActions: ["open_builder", "open_qa", "build_start"],
      artifactSummary: {
        spec: { present: false, updatedAt: undefined },
        plan: { present: false, updatedAt: undefined },
        qaReport: { present: true, updatedAt: "2026-03-09T10:00:00.000Z", verdict: "rejected" },
      },
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("build_start");
    expect(result.secondaryActions).toEqual(["open_builder", "open_qa"]);
  });

  test("uses human_approve as primary during human review", () => {
    const task = createTaskCardFixture({
      status: "human_review",
      issueType: "feature",
      availableActions: [
        "open_builder",
        "qa_start",
        "human_request_changes",
        "human_approve",
        "reset_implementation",
      ],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("human_approve");
    expect(result.secondaryActions).toContain("qa_start");
    expect(result.secondaryActions).toContain("reset_implementation");
  });

  test("keeps reset task last so detail menus place it above delete", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      issueType: "task",
      availableActions: ["open_builder", "reset_implementation", "reset_task"],
    });

    const result = resolveTaskCardActions(task, {
      include: ["open_builder", "reset_implementation", "reset_task"],
    });

    expect(result.primaryAction).toBe("open_builder");
    expect(result.secondaryActions).toEqual(["reset_implementation", "reset_task"]);
  });

  test("keeps close task after ordinary workflow actions when included in details", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      issueType: "task",
      availableActions: ["open_builder", "reset_implementation", "reset_task", "close_task"],
    });

    const result = resolveTaskCardActions(task, {
      include: ["open_builder", "reset_implementation", "reset_task", "close_task"],
    });

    expect(result.primaryAction).toBe("open_builder");
    expect(result.secondaryActions).toEqual(["reset_implementation", "reset_task", "close_task"]);
  });

  test("excludes close_task from default kanban card actions", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      issueType: "task",
      availableActions: ["open_builder", "close_task"],
    });

    expect(resolveTaskCardActions(task).allActions).toEqual(["open_builder"]);
  });

  test("ignores close_task for Agent Studio quick actions", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      issueType: "task",
      availableActions: ["build_start", "close_task"],
    });

    const result = resolveTaskCardActions(task, {
      surface: "agent_studio_quick_actions",
    });

    expect(result.allActions).toContain("build_start");
    expect(result.allActions).not.toContain("close_task");
  });

  test("offers review actions without build_start during human review", () => {
    const reviewTask = createTaskCardFixture({ status: "human_review", issueType: "feature" });
    const task = {
      ...reviewTask,
      availableActions: deriveTaskProjection(reviewTask).availableActions,
    };

    expect(resolveTaskCardActions(task, { include: CARD_ACTIONS }).allActions).toEqual([
      "human_approve",
      "human_request_changes",
      "qa_start",
      "open_builder",
      "set_spec",
      "set_plan",
      "reset_implementation",
    ]);
  });

  test("uses active session role as primary and hides session-creating actions", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      issueType: "task",
      availableActions: [
        "build_start",
        "set_spec",
        "set_plan",
        "qa_start",
        "open_builder",
        "open_qa",
      ],
    });

    const result = resolveTaskCardActions(task, {
      hasActiveSession: true,
      activeSessionRole: "planner",
      historicalSessionRoles: ["spec", "qa"],
    });

    expect(result.primaryAction).toBe("open_planner");
    expect(result.allActions).not.toContain("build_start");
    expect(result.allActions).not.toContain("set_spec");
    expect(result.allActions).not.toContain("set_plan");
    expect(result.allActions).not.toContain("qa_start");
    expect(result.secondaryActions).toEqual(
      expect.arrayContaining(["open_spec", "open_qa", "open_builder"]),
    );
  });

  test("adds historical role view actions as secondary when there is no active session", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      issueType: "feature",
      availableActions: ["build_start", "qa_start"],
    });

    const result = resolveTaskCardActions(task, {
      historicalSessionRoles: ["spec", "planner"],
    });

    expect(result.primaryAction).toBe("build_start");
    expect(result.secondaryActions).toEqual(
      expect.arrayContaining(["open_spec", "open_planner", "qa_start"]),
    );
  });

  test("a ready spec offers open_spec instead of set_spec", () => {
    const task = createTaskCardFixture({ status: "spec_ready", issueType: "feature" });

    const { availableActions } = deriveTaskProjection(task);

    expect(availableActions).toContain("open_spec");
    expect(availableActions).not.toContain("set_spec");
  });
});

describe("taskActionLabel", () => {
  test("uses builder naming consistently for standard workflow actions", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      artifactSummary: {
        spec: { present: false },
        plan: { present: false },
        qaReport: { present: false },
      },
    });

    expect(taskActionLabel("build_start", task)).toBe("Start Builder");
    expect(taskActionLabel("qa_start", task)).toBe("Request QA Review");
    expect(taskActionLabel("open_builder", task)).toBe("Open Builder");
    expect(taskActionLabel("open_spec", task)).toBe("Open Spec");
    expect(taskActionLabel("open_planner", task)).toBe("Open Planner");
    expect(taskActionLabel("human_approve", task)).toBe("Approve Task");
    expect(taskActionLabel("reset_implementation", task)).toBe("Reset Implementation");
    expect(taskActionLabel("reset_task", task)).toBe("Reset Task");
    expect(taskActionLabel("close_task", task)).toBe("Close Task");
  });
  test("uses qa rework label for rejected tasks", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      artifactSummary: {
        spec: { present: false },
        plan: { present: false },
        qaReport: { present: true, verdict: "rejected" },
      },
    });

    expect(taskActionLabel("build_start", task)).toBe("Address QA Feedbacks");
    expect(taskActionLabel("open_qa", task)).toBe("Open QA");
  });
  test("uses request wording for qa action during human review", () => {
    const task = createTaskCardFixture({
      status: "human_review",
      artifactSummary: {
        spec: { present: false },
        plan: { present: false },
        qaReport: { present: true, verdict: "approved" },
      },
    });

    expect(taskActionLabel("qa_start", task)).toBe("Request QA Review");
  });
  test("uses request wording for qa action during ai review", () => {
    const task = createTaskCardFixture({
      status: "ai_review",
      artifactSummary: {
        spec: { present: false },
        plan: { present: false },
        qaReport: { present: false },
      },
    });

    expect(taskActionLabel("qa_start", task)).toBe("Request QA Review");
  });
});
