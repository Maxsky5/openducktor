import { describe, expect, mock, test } from "bun:test";
import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { TaskWorkflowActionsContext } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { WorkspaceActivityContext } from "@openducktor/frontend-core/workspace-activity/workspace-activity-context";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  createTaskWorkflowActionsFixture,
  createWorkspaceActivityObserverStub,
} from "@/test-utils/shared-test-fixtures";
import { TaskWorkflowSection } from "./task-workflow-section";

const workspace = { workspaceId: "workspace-1", repoPath: "/repo" };

const renderSection = (
  task: ReturnType<typeof createTaskCardFixture>,
  onOpenSession = mock((_taskId: string, _role: string) => {}),
) => {
  const connection = createTestClientConnection({
    client: { agentSessionsListForTasks: async () => [] },
  });
  render(
    <MemoryRouter>
      <QueryProvider connection={connection}>
        <WorkspaceActivityContext.Provider value={createWorkspaceActivityObserverStub()}>
          <TaskWorkflowActionsContext value={createTaskWorkflowActionsFixture({ onOpenSession })}>
            <TaskWorkflowSection task={task} workspace={workspace} />
          </TaskWorkflowActionsContext>
        </WorkspaceActivityContext.Provider>
      </QueryProvider>
    </MemoryRouter>,
  );
  return onOpenSession;
};

describe("TaskWorkflowSection", () => {
  test("names the workflow and its version, and links to it", () => {
    renderSection(createTaskCardFixture({ status: "spec_ready" }));
    expect(screen.getByText("Spec, Plan, Build · Built-in")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "View the workflow Spec, Plan, Build" })
        .getAttribute("href"),
    ).toBe("/workflows/openducktor-spec-plan-build");
  });

  test("shows the role lane and opens the session of a role", () => {
    const task = createTaskCardFixture({ status: "spec_ready" });
    const onOpenSession = renderSection(task);
    const lane = screen.getByRole("region", { name: "Role lane" });
    const first = task.taskWorkflow.definition.steps.find((step) => step.kind === "agent");
    if (first?.kind !== "agent") throw new Error("The built-in workflow has an agent step.");
    fireEvent.click(within(lane).getByRole("button", { name: new RegExp(first.label) }));
    expect(onOpenSession).toHaveBeenCalledWith(task.id, first.roleId, undefined);
  });
});
