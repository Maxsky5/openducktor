import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { deriveAgentWorkflows, deriveTaskProjection, isQaRejectedTask } from "./task-projection";
import type { BuiltinTask } from "./facts";

/** The task fields that the workflow reads. */
const task = (overrides: Partial<BuiltinTask> = {}): BuiltinTask => ({
  id: "task-1",
  status: "open",
  issueType: "feature",
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  ...overrides,
});

const deriveAvailableActions = (current: TaskCard) =>
  deriveTaskProjection(current).availableActions;

describe("built-in task projection", () => {
  test("derives role workflows from task type, status, and documents", () => {
    const workflows = deriveAgentWorkflows(
      task({
        issueType: "feature",
        status: "ready_for_dev",
        artifactSummary: {
          spec: { present: true },
          plan: { present: true },
          qaReport: { present: false },
        },
      }),
    );
    expect(workflows.spec.completed).toBe(true);
    expect(workflows.planner.completed).toBe(true);
    expect(workflows.build.available).toBe(true);
    expect(deriveAgentWorkflows(task({ status: "ready_for_dev" })).build.available).toBe(true);
  });

  test("keeps QA available for blocked and review tasks only", () => {
    for (const status of ["blocked", "human_review"] as const) {
      const current = task({ status });
      expect(deriveAgentWorkflows(current).qa.available).toBe(true);
      expect(deriveAvailableActions(current)).toContain("qa_start");
    }
    for (const status of ["ready_for_dev", "in_progress"] as const) {
      const current = task({ status });
      expect(deriveAgentWorkflows(current).qa.available).toBe(false);
      expect(deriveAvailableActions(current)).not.toContain("qa_start");
    }
  });

  test("offers Builder rework and QA for QA-rejected tasks", () => {
    const current = task({
      status: "blocked",
      artifactSummary: {
        spec: { present: false },
        plan: { present: false },
        qaReport: { present: true, verdict: "rejected" },
      },
    });
    expect(isQaRejectedTask(current)).toBe(true);
    expect(deriveAvailableActions(current)).toEqual(
      expect.arrayContaining(["qa_start", "build_start", "open_qa"]),
    );
    expect(isQaRejectedTask({ ...current, status: "ai_review" })).toBe(false);
    expect(isQaRejectedTask(null)).toBe(false);
  });

  test("offers review actions only in review and manual close only before closure", () => {
    expect(deriveAvailableActions(task({ status: "in_progress" }))).not.toContain(
      "human_request_changes",
    );
    expect(deriveAvailableActions(task({ status: "human_review" }))).toEqual(
      expect.arrayContaining(["human_request_changes", "human_approve", "close_task"]),
    );
    expect(deriveAvailableActions(task({ status: "open" }))).toContain("close_task");
    expect(deriveAvailableActions(task({ status: "open" }))).not.toContain("human_approve");
    expect(deriveAvailableActions(task({ status: "closed" }))).toEqual(["view_details"]);
  });

  test("shares one frozen projection for tasks with equal inputs", () => {
    const first = deriveTaskProjection(task({ id: "first", status: "blocked" }));
    const second = deriveTaskProjection(task({ id: "second", status: "blocked" }));
    expect(second).toBe(first);
    expect(Object.isFrozen(first.availableActions)).toBe(true);
    expect(Object.isFrozen(first.agentWorkflows.build)).toBe(true);
    expect(deriveAgentWorkflows(task({ id: "third", status: "blocked" }))).toEqual(
      first.agentWorkflows,
    );
  });

  test("keeps the board action order", () => {
    expect(deriveAvailableActions(task({ status: "human_review" }))).toEqual([
      "view_details",
      "set_spec",
      "set_plan",
      "qa_start",
      "open_builder",
      "reset_implementation",
      "reset_task",
      "human_request_changes",
      "human_approve",
      "close_task",
    ]);
  });
});
