import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";

enableReactActEnvironment();

const workflowActionGroupRenderMock = mock((_: unknown) => {});

describe("TaskDetailsSheetFooter", () => {
  beforeAll(() => {
    mock.module("@/components/features/kanban/task-workflow-action-group", () => ({
      TaskWorkflowActionGroup: (props: unknown): ReactElement => {
        workflowActionGroupRenderMock(props);
        return <div data-testid="workflow-actions" />;
      },
    }));
  });

  beforeEach(() => {
    workflowActionGroupRenderMock.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  test("omits workflow action placeholder when no workflow actions are available", async () => {
    const { TaskDetailsSheetFooter } = await import("./task-details-sheet-footer");

    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({ status: "closed", availableActions: [] })}
        onOpenChange={() => {}}
        includeActions={["human_approve", "human_request_changes", "open_builder", "build_start"]}
        onWorkflowAction={() => {}}
      />,
    );

    expect(workflowActionGroupRenderMock).not.toHaveBeenCalled();

    unmount();
  });

  test("keeps footer action menu when delete is available without workflow actions", async () => {
    const { TaskDetailsSheetFooter } = await import("./task-details-sheet-footer");

    const { unmount } = render(
      <TaskDetailsSheetFooter
        task={createTaskCardFixture({ status: "closed", availableActions: [] })}
        onOpenChange={() => {}}
        includeActions={["human_approve", "human_request_changes", "open_builder", "build_start"]}
        onWorkflowAction={() => {}}
        onDeleteSelect={() => {}}
      />,
    );

    expect(workflowActionGroupRenderMock).toHaveBeenCalledTimes(1);
    expect(workflowActionGroupRenderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hideWhenEmpty: true,
      }),
    );

    unmount();
  });
});
