import { builtinCompiledCatalogFixture } from "@openducktor/frontend-core/test-support/workflow-fixtures";
import { workflowQueryKeys } from "@openducktor/frontend-core/queries/workflows";
import { buildWorkflowModelContext } from "@/pages/agents/use-agent-studio-page-model-builders";
import { SessionViewContext } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ShortcutTestProviders } from "@/test-utils/shortcut-providers";
import { TaskWorkflowActionsContext } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  createTaskCardFixture,
  createTaskWorkflowActionsFixture,
} from "@/test-utils/shared-test-fixtures";
import {} from "../command-palette/command-palette-registry";
import { useShortcutDispatch } from "./use-shortcut-dispatch";
import { TaskSessionShortcuts } from "./task-session-shortcuts";

const header: Parameters<typeof TaskSessionShortcuts>[0]["header"] = {
  agentStudioReady: true,
  isCreatingSession: false,
  onResolveGitConflictQuickAction: null,
  quickActions: [],
  workflowSteps: [],
  onOpenTaskDetails: () => {},
  onQuickAction: () => {},
  onWorkflowStepSelect: () => {},
};
afterEach(cleanup);

function Input() {
  useShortcutDispatch({
    platform: "darwin",
    actions: [],
    isOpen: false,
    open: () => {},
    close: () => {},
    runAfterClose: (run) => run(),
  });
  return null;
}

test("editing follows the visible loaded task without another task or session read", async () => {
  const onEdit = mock((_taskId: string) => {});
  const tasksList = mock(async () => []);
  const workspaceSessionListActive = mock(async () => []);
  const connection = createTestClientConnection({
    client: { tasksList, workspaceSessionListActive },
    scheduleTask: () => () => {},
  });
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
  const actions = createTaskWorkflowActionsFixture({ onEdit });
  const first = createTaskCardFixture({ id: "first" });
  const second = createTaskCardFixture({ id: "second" });
  function VisibleTask({ task }: { task: typeof first }) {
    return (
      <>
        <TaskSessionShortcuts task={task} sessions={[]} header={header} />
        <input aria-label="Draft" />
      </>
    );
  }
  const tree = (task: typeof first) => (
    <ShortcutTestProviders connection={connection}>
      <TaskWorkflowActionsContext value={actions}>
        <Input />
        <SessionViewContext value={{ id: "first", isActive: task.id === first.id }}>
          <VisibleTask task={first} />
        </SessionViewContext>
        <SessionViewContext value={{ id: "second", isActive: task.id === second.id }}>
          <VisibleTask task={second} />
        </SessionViewContext>
      </TaskWorkflowActionsContext>
    </ShortcutTestProviders>
  );
  const view = render(tree(first));
  await act(async () => {});
  fireEvent.keyDown(window, { key: "e", metaKey: true });
  expect(onEdit.mock.calls).toEqual([["first"]]);
  await act(async () => view.rerender(tree(second)));
  fireEvent.keyDown(window, { key: "e", metaKey: true });
  expect(onEdit.mock.calls).toEqual([["first"], ["second"]]);
  act(() => view.getAllByRole("textbox", { name: "Draft" })[0]!.focus());
  fireEvent.keyDown(window, { key: "e", metaKey: true });
  expect(onEdit).toHaveBeenCalledTimes(2);
  expect(tasksList).not.toHaveBeenCalled();
  expect(workspaceSessionListActive).not.toHaveBeenCalled();
  view.unmount();
  await connection.dispose();
});

test("an assigned session workflow action uses the visible header handler and its pending guard", async () => {
  const task = createTaskCardFixture({
    id: "workflow-task",
    status: "ready_for_dev",
    availableActions: ["build_start"],
  });
  const workflow = buildWorkflowModelContext({
    selectedTask: task,
    sessionsForTask: [],
    selectedSessionIdentity: null,
    role: null,
    isSessionWorking: false,
    roleLabelByRole: { build: "Builder", spec: "Spec", planner: "Planner", qa: "QA" },
  });
  const option = workflow.quickActions.find((option) => option.kind === "session_start");
  if (!option) throw new Error("The fixture has no session workflow action.");
  const onQuickAction = mock((_option: Parameters<typeof header.onQuickAction>[0]) => {});
  const connection = createTestClientConnection({ scheduleTask: () => () => {} });
  connection.queryClient.setQueryData(workflowQueryKeys.catalog, builtinCompiledCatalogFixture);
  connection.queryClient.setQueryData(["keyboard-shortcuts"], {
    version: 1,
    overrides: {
      [`workflow:${task.taskWorkflow.definition.id}:build_start`]: {
        key: { kind: "logical", key: "F9" },
        ctrl: true,
        meta: false,
        alt: false,
        shift: true,
      },
    },
  });
  const actions = createTaskWorkflowActionsFixture();
  const tree = (pending: boolean) => (
    <ShortcutTestProviders connection={connection}>
      <TaskWorkflowActionsContext value={actions}>
        <Input />
        <TaskSessionShortcuts
          task={task}
          sessions={[]}
          header={{
            ...header,
            quickActions: workflow.quickActions,
            onQuickAction,
            isCreatingSession: pending,
          }}
        />
      </TaskWorkflowActionsContext>
    </ShortcutTestProviders>
  );
  const view = render(tree(false));
  await act(async () => {});
  fireEvent.keyDown(window, { key: "F9", ctrlKey: true, shiftKey: true });
  expect(onQuickAction.mock.calls).toEqual([[option]]);
  await act(async () => view.rerender(tree(true)));
  expect(fireEvent.keyDown(window, { key: "F9", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(onQuickAction).toHaveBeenCalledTimes(1);
  view.unmount();
  await connection.dispose();
});
