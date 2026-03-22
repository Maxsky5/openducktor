import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../agents/agent-studio-test-utils";
import { resolveKanbanBuildStartScenario } from "./use-kanban-session-start-flow";

describe("resolveKanbanBuildStartScenario", () => {
  test("uses implementation start for regular build starts", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "ready_for_dev" });

    expect(resolveKanbanBuildStartScenario([task], "TASK-1")).toBe("build_implementation_start");
  });

  test("uses QA rejection follow-up for QA-rejected tasks", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "in_progress" });
    task.documentSummary.qaReport = {
      has: true,
      updatedAt: "2026-03-09T10:00:00.000Z",
      verdict: "rejected",
    };

    expect(resolveKanbanBuildStartScenario([task], "TASK-1")).toBe("build_after_qa_rejected");
  });

  test("uses human-feedback follow-up for human-review tasks", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "human_review" });

    expect(resolveKanbanBuildStartScenario([task], "TASK-1")).toBe(
      "build_after_human_request_changes",
    );
  });
});
