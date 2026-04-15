import { describe, expect, mock, test } from "bun:test";
import { useState } from "react";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import { enableReactActEnvironment } from "./agent-studio-test-utils";
import { useTaskTabActions } from "./use-agent-studio-task-tabs-actions";

enableReactActEnvironment();

type HookArgs = Omit<
  Parameters<typeof useTaskTabActions>[0],
  "tabTaskIds" | "setOpenTaskTabs" | "setPersistedActiveTaskId" | "setIntentActiveTaskId"
> & {
  initialOpenTaskTabs: string[];
  initialPersistedActiveTaskId?: string | null;
  initialIntentActiveTaskId?: string | null;
};

const useTaskTabActionsHarness = (props: HookArgs) => {
  const [openTaskTabs, setOpenTaskTabs] = useState(props.initialOpenTaskTabs);
  const [persistedActiveTaskId, setPersistedActiveTaskId] = useState(
    props.initialPersistedActiveTaskId ?? null,
  );
  const [intentActiveTaskId, setIntentActiveTaskId] = useState(
    props.initialIntentActiveTaskId ?? null,
  );

  const actions = useTaskTabActions({
    tabTaskIds: openTaskTabs,
    activeTaskTabId: props.activeTaskTabId,
    clearComposerInput: props.clearComposerInput,
    onContextSwitchIntent: props.onContextSwitchIntent,
    clearTaskSelection: props.clearTaskSelection,
    navigateToTaskIntent: props.navigateToTaskIntent,
    handleSelectTab: props.handleSelectTab,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setIntentActiveTaskId,
  });

  return {
    ...actions,
    openTaskTabs,
    persistedActiveTaskId,
    intentActiveTaskId,
  };
};

const createHookHarness = (initialProps: HookArgs) =>
  createCoreHookHarness(useTaskTabActionsHarness, initialProps);

describe("useTaskTabActions", () => {
  test("delegates create-tab actions to the select handler", async () => {
    const handleSelectTab = mock(() => {});
    const harness = createHookHarness({
      initialOpenTaskTabs: ["task-1"],
      activeTaskTabId: "task-1",
      clearComposerInput: () => {},
      onContextSwitchIntent: undefined,
      clearTaskSelection: () => {},
      navigateToTaskIntent: () => {},
      handleSelectTab,
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleCreateTab("task-2");
    });

    expect(handleSelectTab).toHaveBeenCalledWith("task-2");

    await harness.unmount();
  });

  test("closing an inactive tab avoids active-tab side effects", async () => {
    const clearComposerInput = mock(() => {});
    const onContextSwitchIntent = mock(() => {});
    const clearTaskSelection = mock(() => {});
    const navigateToTaskIntent = mock(() => {});
    const harness = createHookHarness({
      initialOpenTaskTabs: ["task-1", "task-2"],
      initialPersistedActiveTaskId: "task-1",
      activeTaskTabId: "task-1",
      clearComposerInput,
      onContextSwitchIntent,
      clearTaskSelection,
      navigateToTaskIntent,
      handleSelectTab: () => {},
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleCloseTab("task-2");
    });

    expect(harness.getLatest()).toEqual({
      handleCreateTab: harness.getLatest().handleCreateTab,
      handleCloseTab: harness.getLatest().handleCloseTab,
      openTaskTabs: ["task-1"],
      persistedActiveTaskId: "task-1",
      intentActiveTaskId: null,
    });
    expect(clearComposerInput).toHaveBeenCalledTimes(0);
    expect(onContextSwitchIntent).toHaveBeenCalledTimes(0);
    expect(clearTaskSelection).toHaveBeenCalledTimes(0);
    expect(navigateToTaskIntent).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });

  test("closing the active tab focuses and navigates to the adjacent replacement tab", async () => {
    const clearComposerInput = mock(() => {});
    const onContextSwitchIntent = mock(() => {});
    const clearTaskSelection = mock(() => {});
    const navigateToTaskIntent = mock(() => {});
    const nextTrigger = globalThis.document.createElement("button");
    nextTrigger.id = "agent-studio-tab-task-3";
    globalThis.document.body.appendChild(nextTrigger);

    const harness = createHookHarness({
      initialOpenTaskTabs: ["task-1", "task-2", "task-3"],
      initialPersistedActiveTaskId: "task-2",
      activeTaskTabId: "task-2",
      clearComposerInput,
      onContextSwitchIntent,
      clearTaskSelection,
      navigateToTaskIntent,
      handleSelectTab: () => {},
    });

    try {
      await harness.mount();
      await harness.run((state) => {
        state.handleCloseTab("task-2");
      });
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, 0);
      });

      const latest = harness.getLatest();
      expect(latest.openTaskTabs).toEqual(["task-1", "task-3"]);
      expect(latest.persistedActiveTaskId).toBe("task-3");
      expect(latest.intentActiveTaskId).toBe("task-3");
      expect(clearComposerInput).toHaveBeenCalledTimes(1);
      expect(onContextSwitchIntent).toHaveBeenCalledTimes(1);
      expect(clearTaskSelection).toHaveBeenCalledTimes(0);
      expect(navigateToTaskIntent).toHaveBeenCalledWith("task-3");
      expect(globalThis.document.activeElement).toBe(nextTrigger);
    } finally {
      await harness.unmount();
      nextTrigger.remove();
    }
  });

  test("closing the last active tab clears the current selection", async () => {
    const clearComposerInput = mock(() => {});
    const onContextSwitchIntent = mock(() => {});
    const clearTaskSelection = mock(() => {});
    const navigateToTaskIntent = mock(() => {});
    const harness = createHookHarness({
      initialOpenTaskTabs: ["task-1"],
      initialPersistedActiveTaskId: "task-1",
      activeTaskTabId: "task-1",
      clearComposerInput,
      onContextSwitchIntent,
      clearTaskSelection,
      navigateToTaskIntent,
      handleSelectTab: () => {},
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleCloseTab("task-1");
    });

    const latest = harness.getLatest();
    expect(latest.openTaskTabs).toEqual([]);
    expect(latest.persistedActiveTaskId).toBeNull();
    expect(latest.intentActiveTaskId).toBeNull();
    expect(clearComposerInput).toHaveBeenCalledTimes(1);
    expect(onContextSwitchIntent).toHaveBeenCalledTimes(1);
    expect(clearTaskSelection).toHaveBeenCalledTimes(1);
    expect(navigateToTaskIntent).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });
});
