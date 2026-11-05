import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { describe, expect, test } from "bun:test";
import { canDetectTaskPullRequest, canUnlinkTaskPullRequest } from "./task-display";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

const makeTask = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createTaskCardFixture({
    ...createTaskCardFixture(),
    id: "TASK-1",
    title: "Task",
    description: "",
    status: "in_progress",
    priority: 2,
    issueType: "task",
    removeWorktreeOnClose: null,
    availableActions: [],
    labels: [],
    artifactSummary: {
      spec: { present: false },
      plan: { present: false },
      qaReport: { present: false },
    },
    agentWorkflows: {
      spec: { required: false, canSkip: true, available: true, completed: false },
      planner: { required: false, canSkip: true, available: true, completed: false },
      build: { required: true, canSkip: false, available: true, completed: false },
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
            build: { required: true, canSkip: false, available: true, completed: true },
            qa: { required: false, canSkip: true, available: false, completed: false },
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("canUnlinkTaskPullRequest", () => {
  test.each(["open", "ready_for_dev", "in_progress", "human_review"])(
    "allows pull request management in %s without a workflow event",
    (status) => {
      expect(canUnlinkTaskPullRequest(makeTask({ status }))).toBe(true);
    },
  );

  test("rejects pull request management of a closed task", () => {
    expect(canUnlinkTaskPullRequest(makeTask({ status: "closed" }))).toBe(false);
  });
});
