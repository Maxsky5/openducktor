import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";

enableReactActEnvironment();

const workflowActionGroupRenderMock = mock((_: unknown) => {});

mock.module("@/components/features/kanban/task-workflow-action-group", () => ({
  TaskWorkflowActionGroup: (props: unknown): ReactElement => {
    workflowActionGroupRenderMock(props);
    return <div data-testid="workflow-actions" />;
  },
}));

describe("TaskDetailsSheetFooter", () => {
  beforeEach(() => {
    workflowActionGroupRenderMock.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  test("omits workflow action placeholder when no workflow actions are available", async () => {
    const { TaskDetailsSheetFooter } = await import("./task-details-sheet-footer");

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TaskDetailsSheetFooter
          task={createTaskCardFixture({ status: "closed", availableActions: [] })}
          onOpenChange={() => {}}
          includeActions={["human_approve", "human_request_changes", "open_builder", "build_start"]}
          onWorkflowAction={() => {}}
        />,
      );
    });

    expect(workflowActionGroupRenderMock).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  test("keeps footer action menu when delete is available without workflow actions", async () => {
    const { TaskDetailsSheetFooter } = await import("./task-details-sheet-footer");

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TaskDetailsSheetFooter
          task={createTaskCardFixture({ status: "closed", availableActions: [] })}
          onOpenChange={() => {}}
          includeActions={["human_approve", "human_request_changes", "open_builder", "build_start"]}
          onWorkflowAction={() => {}}
          onDeleteSelect={() => {}}
        />,
      );
    });

    expect(workflowActionGroupRenderMock).toHaveBeenCalledTimes(1);
    expect(workflowActionGroupRenderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hideWhenEmpty: true,
      }),
    );

    await act(async () => {
      renderer.unmount();
    });
  });
});
