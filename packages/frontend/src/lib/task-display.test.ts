import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { canDetectTaskPullRequest, statusBadgeClassName } from "./task-display";

const makeTask = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "TASK-1",
  title: "Task",
  description: "",
  notes: "",
  status: "in_progress",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-03-13T10:00:00Z",
  createdAt: "2026-03-13T10:00:00Z",
  ...overrides,
});

describe("canDetectTaskPullRequest", () => {
  test("returns false for in-progress tasks without completed builder workflow", () => {
    expect(canDetectTaskPullRequest(makeTask())).toBe(false);
  });

  test("returns true when the builder workflow is completed", () => {
    expect(
      canDetectTaskPullRequest(
        makeTask({
          agentWorkflows: {
            spec: { required: false, canSkip: true, available: true, completed: false },
            planner: { required: false, canSkip: true, available: true, completed: false },
            builder: { required: true, canSkip: false, available: true, completed: true },
            qa: { required: false, canSkip: true, available: false, completed: false },
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("statusBadgeClassName", () => {
  test("maps workflow review and planning statuses to their dedicated colors", () => {
    expect(statusBadgeClassName("spec_ready")).toContain("pending");
    expect(statusBadgeClassName("ready_for_dev")).toContain("info");
    expect(statusBadgeClassName("ai_review")).toContain("indigo");
    expect(statusBadgeClassName("human_review")).toContain("cyan");
  });
});
