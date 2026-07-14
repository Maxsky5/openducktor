import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { TaskWorkflowActionGroup } from "./task-workflow-action-group";

enableReactActEnvironment();

function renderWorkflowActionGroup(compactMenuTrigger = false) {
  return render(
    <TaskWorkflowActionGroup
      task={createTaskCardFixture({
        status: "in_progress",
        issueType: "task",
        availableActions: ["open_builder", "open_qa", "build_start"],
        documentSummary: {
          spec: { has: false, updatedAt: undefined },
          plan: { has: false, updatedAt: undefined },
          qaReport: { has: true, updatedAt: "2026-03-09T10:00:00.000Z", verdict: "rejected" },
        },
      })}
      onAction={() => {}}
      compactMenuTrigger={compactMenuTrigger}
    />,
  );
}

describe("TaskWorkflowActionGroup", () => {
  test("names the compact workflow menu trigger", () => {
    const { unmount } = renderWorkflowActionGroup(true);

    expect(screen.getByRole("button", { name: "Open workflow actions menu" })).toBeDefined();

    unmount();
  });

  test("keeps the noncompact workflow menu trigger named More", () => {
    const { unmount } = renderWorkflowActionGroup();

    expect(screen.getByRole("button", { name: "More" })).toBeDefined();

    unmount();
  });
});
