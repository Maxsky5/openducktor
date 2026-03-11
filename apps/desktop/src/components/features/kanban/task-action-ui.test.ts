import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { taskActionLabel } from "./task-action-ui";

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
    expect(taskActionLabel("defer_issue", task)).toBe("Defer Task");
    expect(taskActionLabel("resume_deferred", task)).toBe("Resume Task");
    expect(taskActionLabel("human_approve", task)).toBe("Approve Task");
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
});
