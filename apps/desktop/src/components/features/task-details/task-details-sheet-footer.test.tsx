import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { TaskDetailsSheetFooter } from "./task-details-sheet-footer";

enableReactActEnvironment();

describe("TaskDetailsSheetFooter", () => {
  test("omits workflow actions when no workflow actions are available", () => {
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({ status: "closed", availableActions: [] })}
        onOpenChange={() => {}}
        includeActions={["human_approve", "human_request_changes", "open_builder", "build_start"]}
        onWorkflowAction={() => {}}
      />,
    );

    expect(screen.queryByText("More")).toBeNull();
    expect(screen.queryByText("No available workflow action")).toBeNull();

    unmount();
  });

  test("keeps footer action menu when delete is available without workflow actions", () => {
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({ status: "closed", availableActions: [] })}
        onOpenChange={() => {}}
        includeActions={["human_approve", "human_request_changes", "open_builder", "build_start"]}
        onWorkflowAction={() => {}}
        onDeleteSelect={() => {}}
      />,
    );

    expect(screen.getByText("More")).toBeDefined();

    unmount();
  });

  test("renders active-session view action when active and historical context is provided", () => {
    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({
          status: "in_progress",
          availableActions: ["open_builder", "build_start"],
        })}
        onOpenChange={() => {}}
        includeActions={["open_builder", "open_spec", "open_planner", "build_start"]}
        hasActiveSession
        activeSessionRole="build"
        historicalSessionRoles={["spec", "planner"]}
        onWorkflowAction={() => {}}
      />,
    );

    expect(screen.getByText("Open Builder")).toBeDefined();
    expect(screen.getByText("More")).toBeDefined();
    expect(screen.queryByText("Start Builder")).toBeNull();

    unmount();
  });
});
