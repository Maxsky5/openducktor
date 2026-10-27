import { describe, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { TaskWorkflowActionGroup } from "./task-workflow-action-group";

function renderWorkflowActionGroup(compactMenuTrigger = false) {
  render(
    <TaskWorkflowActionGroup
      task={createTaskCardFixture({
        status: "in_progress",
        issueType: "task",
        availableActions: ["open_builder", "open_qa", "build_start"],
        artifactSummary: {
          spec: { present: false, updatedAt: undefined },
          plan: { present: false, updatedAt: undefined },
          qaReport: { present: true, updatedAt: "2026-03-09T10:00:00.000Z", verdict: "rejected" },
        },
      })}
      onAction={() => {}}
      compactMenuTrigger={compactMenuTrigger}
    />,
  );
}

describe("TaskWorkflowActionGroup", () => {
  test("names the compact workflow menu trigger", () => {
    renderWorkflowActionGroup(true);

    screen.getByRole("button", { name: "Open workflow actions menu" });
  });

  test("keeps the noncompact workflow menu trigger named More", () => {
    renderWorkflowActionGroup();

    screen.getByRole("button", { name: "More" });
  });
});
