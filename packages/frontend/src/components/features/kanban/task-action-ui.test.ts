import { describe, expect, test } from "bun:test";
import { CircleCheckBig } from "lucide-react";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import {
  TASK_ACTION_ICON,
  taskActionIsDestructive,
  taskActionIsWarning,
  taskActionLabel,
  taskPrimaryActionVariant,
} from "./task-action-ui";

describe("taskActionLabel", () => {
  test("uses builder naming consistently for standard workflow actions", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: false, updatedAt: undefined, verdict: "not_reviewed" },
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

  test("uses open wording for spec-ready follow-up actions", () => {
    const task = createTaskCardFixture({
      status: "spec_ready",
      documentSummary: {
        spec: { has: true, updatedAt: "2026-03-09T10:00:00.000Z" },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: false, updatedAt: undefined, verdict: "not_reviewed" },
      },
    });

    expect(taskActionLabel("set_spec", task)).toBe("Open Spec");
  });

  test("uses qa rework label for rejected tasks", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: true, updatedAt: "2026-03-09T10:00:00.000Z", verdict: "rejected" },
      },
    });

    expect(taskActionLabel("build_start", task)).toBe("Address QA Feedbacks");
    expect(taskActionLabel("open_qa", task)).toBe("Open QA");
  });

  test("uses request wording for qa action during human review", () => {
    const task = createTaskCardFixture({
      status: "human_review",
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: true, updatedAt: "2026-03-09T10:00:00.000Z", verdict: "approved" },
      },
    });

    expect(taskActionLabel("qa_start", task)).toBe("Request QA Review");
  });

  test("uses request wording for qa action during ai review", () => {
    const task = createTaskCardFixture({
      status: "ai_review",
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: false, updatedAt: undefined, verdict: "not_reviewed" },
      },
    });

    expect(taskActionLabel("qa_start", task)).toBe("Request QA Review");
  });

  test("keeps request changes as a non-destructive workflow action", () => {
    expect(taskPrimaryActionVariant("human_request_changes")).toBe("outline");
    expect(taskPrimaryActionVariant("reset_implementation")).toBe("destructive");
    expect(taskPrimaryActionVariant("reset_task")).toBe("destructive");
    expect(taskPrimaryActionVariant("close_task")).toBe("outline");

    expect(taskActionIsDestructive("human_request_changes")).toBe(false);
    expect(taskActionIsDestructive("reset_implementation")).toBe(true);
    expect(taskActionIsDestructive("reset_task")).toBe(true);
    expect(taskActionIsDestructive("close_task")).toBe(false);
    expect(taskActionIsWarning("close_task")).toBe(true);
  });

  test("uses the approval-style icon for manual close", () => {
    expect(TASK_ACTION_ICON.close_task.type).toBe(CircleCheckBig);
  });
});
