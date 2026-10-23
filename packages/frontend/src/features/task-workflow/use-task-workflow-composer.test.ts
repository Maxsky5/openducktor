import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { taskQueryKeys } from "@openducktor/frontend-core/queries/tasks";
import { createElement, type PropsWithChildren } from "react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { installReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useTaskWorkflowComposer } from "./use-task-workflow-composer";

type Props = { activeWorkspace: ActiveWorkspace | null; tasks: TaskCard[] };

const task = createTaskCardFixture({ id: "odt-1" });
const workspaceA = createWorkspaceRecordFixture({ workspaceId: "w-a", workspaceName: "A" });
const workspaceB = createWorkspaceRecordFixture({ workspaceId: "w-b", workspaceName: "B" });
const inA: Props = { activeWorkspace: workspaceA, tasks: [task] };
const inB: Props = { activeWorkspace: workspaceB, tasks: [task] };

let restoreReactActEnvironment: (() => void) | null = null;
let harness: ReturnType<
  typeof createHookHarness<Props, ReturnType<typeof useTaskWorkflowComposer>>
> | null = null;

let connection: ReturnType<typeof createTestClientConnection>;
const mount = async (props: Props, storedTasks: TaskCard[] = []) => {
  connection = createTestClientConnection({
    client: { tasksList: async () => [], tasksListAll: async () => storedTasks },
  });
  harness = createHookHarness(useTaskWorkflowComposer, props, {
    wrapper: ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: connection.queryClient }, children),
  });
  await harness.mount();
  return harness;
};

beforeEach(() => {
  restoreReactActEnvironment = installReactActEnvironment();
});

afterEach(async () => {
  await harness?.unmount();
  harness = null;
  connection?.queryClient.clear();
  restoreReactActEnvironment?.();
  restoreReactActEnvironment = null;
});

describe("useTaskWorkflowComposer", () => {
  test("closes an edit when its workspace changes and keeps it closed after the return", async () => {
    const hook = await mount(inA);
    await hook.run((state) => state.onEdit(task.id));
    expect(hook.getLatest().composer).toMatchObject({ open: true, task });

    // Workspace B also has a task with the same ID.
    await hook.update(inB);
    expect(hook.getLatest().composer).toMatchObject({ open: false, task: null });

    await hook.update(inA);
    expect(hook.getLatest().composer.open).toBe(false);
  });

  test("edits a closed task outside the board list", async () => {
    const closedTask = { ...task, status: "closed" as const };
    const hook = await mount({ ...inA, tasks: [] }, [closedTask]);
    await hook.run((state) => state.onEdit(task.id));
    await hook.waitFor((state) => state.composer.open);
    expect(hook.getLatest().composer).toMatchObject({
      open: true,
      task: closedTask,
      tasks: [closedTask],
    });
  });

  test("closes an edit when its task is removed from the workspace", async () => {
    const hook = await mount(inA);
    await hook.run((state) => state.onEdit(task.id));

    connection.queryClient.setQueryData(taskQueryKeys.unfilteredRepoData(workspaceA.repoPath), {
      tasks: [],
    });
    await hook.update({ ...inA, tasks: [] });
    await hook.update(inA);

    expect(hook.getLatest().composer.open).toBe(false);
  });

  test("keeps a new task open with its first workspace after a workspace change", async () => {
    const hook = await mount(inA);
    await hook.run((state) => state.onCreateTask({ initialTitle: "Draft" }));

    await hook.update(inB);

    expect(hook.getLatest().composer).toMatchObject({
      open: true,
      task: null,
      initialTitle: "Draft",
      destination: { workspaceId: "w-a", workspaceName: "A" },
    });
  });

  test("ignores the close handler of an earlier form", async () => {
    const hook = await mount(inA);
    await hook.run((state) => state.onEdit(task.id));
    const closeEarlierForm = hook.getLatest().composer.onOpenChange;
    await hook.run((state) => state.onCreateTask());

    await hook.run(() => closeEarlierForm(false));
    expect(hook.getLatest().composer.open).toBe(true);

    await hook.run((state) => state.composer.onOpenChange(false));
    expect(hook.getLatest().composer.open).toBe(false);
  });
});
