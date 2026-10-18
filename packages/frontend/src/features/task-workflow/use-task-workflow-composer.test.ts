import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
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

const mount = async (props: Props) => {
  harness = createHookHarness(useTaskWorkflowComposer, props);
  await harness.mount();
  return harness;
};

beforeEach(() => {
  restoreReactActEnvironment = installReactActEnvironment();
});

afterEach(async () => {
  await harness?.unmount();
  harness = null;
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

  test("closes an edit when its task leaves the task list", async () => {
    const hook = await mount(inA);
    await hook.run((state) => state.onEdit(task.id));

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
