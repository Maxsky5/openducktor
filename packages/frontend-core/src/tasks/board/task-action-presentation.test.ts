import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import {
  taskActionIsDestructive,
  taskActionIsWarning,
  taskActionLabel,
  taskActionTone,
  taskSessionStatusLabel,
} from "./task-action-presentation";

describe("taskActionLabel", () => {
  test("uses builder naming consistently for standard workflow actions", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      artifactSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: false, updatedAt: undefined, verdict: "not_reviewed" },
      },
    });

    expect(taskActionLabel("build_start", task)).toBe("Start Builder");
    expect(taskActionLabel("build_start", task, { surface: "agent_studio" })).toBe(
      "Start Implementation",
    );
    expect(taskActionLabel("qa_start", task)).toBe("Request QA Review");
    expect(taskActionLabel("open_builder", task)).toBe("Open Builder");
    expect(taskActionLabel("open_spec", task)).toBe("Open Spec");
    expect(taskActionLabel("open_planner", task)).toBe("Open Planner");
    expect(taskActionLabel("human_approve", task)).toBe("Approve Task");
    expect(taskActionLabel("human_request_changes", task)).toBe("Request Changes");
    expect(taskActionLabel("reset_implementation", task)).toBe("Reset Implementation");
    expect(taskActionLabel("reset_task", task)).toBe("Reset Task");
    expect(taskActionLabel("close_task", task)).toBe("Close Task");
  });

  test("uses open wording for spec-ready follow-up actions", () => {
    const task = createTaskCardFixture({
      status: "spec_ready",
      artifactSummary: {
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
      artifactSummary: {
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
      artifactSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: true, updatedAt: "2026-03-09T10:00:00.000Z", verdict: "approved" },
      },
    });

    expect(taskActionLabel("qa_start", task)).toBe("Request QA Review");
  });
});

describe("taskActionTone", () => {
  test("keeps request changes as a non-destructive workflow action", () => {
    expect(taskActionTone("build_start")).toBe("prominent");
    expect(taskActionTone("qa_start")).toBe("prominent");
    expect(taskActionTone("human_approve")).toBe("prominent");
    expect(taskActionTone("human_request_changes")).toBe("neutral");
    expect(taskActionTone("reset_implementation")).toBe("destructive");
    expect(taskActionTone("reset_task")).toBe("destructive");
    expect(taskActionTone("close_task")).toBe("warning");

    expect(taskActionIsDestructive("human_request_changes")).toBe(false);
    expect(taskActionIsDestructive("reset_implementation")).toBe(true);
    expect(taskActionIsDestructive("reset_task")).toBe(true);
    expect(taskActionIsDestructive("close_task")).toBe(false);
    expect(taskActionIsWarning("close_task")).toBe(true);
  });
});

describe("taskSessionStatusLabel", () => {
  test("names waiting input before the session state", () => {
    expect(
      taskSessionStatusLabel({ session: { activityState: "running" }, isWaitingInput: true }),
    ).toBe("Waiting input");
    expect(
      taskSessionStatusLabel({ session: { activityState: "starting" }, isWaitingInput: false }),
    ).toBe("Starting");
    expect(
      taskSessionStatusLabel({ session: { activityState: "running" }, isWaitingInput: false }),
    ).toBe("Running");
  });
});
