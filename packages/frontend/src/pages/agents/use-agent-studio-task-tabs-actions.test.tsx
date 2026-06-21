import { describe, expect, mock, test } from "bun:test";
import { useState } from "react";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import { enableReactActEnvironment } from "./agent-studio-test-utils";
import { useTaskTabActions } from "./use-agent-studio-task-tabs-actions";

enableReactActEnvironment();

type HookArgs = Omit<
  Parameters<typeof useTaskTabActions>[0],
  "tabTaskIds" | "setOpenTaskTabs" | "setPersistedActiveTaskId"
> & {
  initialOpenTaskTabs: string[];
  initialPersistedActiveTaskId?: string | null;
};

const useTaskTabActionsHarness = (props: HookArgs) => {
  const [openTaskTabs, setOpenTaskTabs] = useState(props.initialOpenTaskTabs);
  const [persistedActiveTaskId, setPersistedActiveTaskId] = useState(
    props.initialPersistedActiveTaskId ?? null,
  );

  const actions = useTaskTabActions({
    tabTaskIds: openTaskTabs,
    activeTaskTabId: props.activeTaskTabId,
    clearTaskSelection: props.clearTaskSelection,
    selectTask: props.selectTask,
    handleSelectTab: props.handleSelectTab,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
  });

  return {
    ...actions,
    openTaskTabs,
    persistedActiveTaskId,
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
      clearTaskSelection: () => {},
      selectTask: () => {},
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
    const clearTaskSelection = mock(() => {});
    const selectTask = mock(() => {});
    const harness = createHookHarness({
      initialOpenTaskTabs: ["task-1", "task-2"],
      initialPersistedActiveTaskId: "task-1",
      activeTaskTabId: "task-1",
      clearTaskSelection,
      selectTask,
      handleSelectTab: () => {},
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleCloseTab("task-2");
    });

    expect(harness.getLatest()).toEqual({
      handleCreateTab: harness.getLatest().handleCreateTab,
      handleCloseTab: harness.getLatest().handleCloseTab,
      handleReorderTab: harness.getLatest().handleReorderTab,
      openTaskTabs: ["task-1"],
      persistedActiveTaskId: "task-1",
    });
    expect(clearTaskSelection).toHaveBeenCalledTimes(0);
    expect(selectTask).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });

  test("closing the active tab focuses and navigates to the adjacent replacement tab", async () => {
    const clearTaskSelection = mock(() => {});
    const selectTask = mock(() => {});
    const nextTrigger = globalThis.document.createElement("button");
    nextTrigger.id = "agent-studio-tab-task-3";
    globalThis.document.body.appendChild(nextTrigger);

    const harness = createHookHarness({
      initialOpenTaskTabs: ["task-1", "task-2", "task-3"],
      initialPersistedActiveTaskId: "task-2",
      activeTaskTabId: "task-2",
      clearTaskSelection,
      selectTask,
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
      expect(typeof latest.handleReorderTab).toBe("function");
      expect(clearTaskSelection).toHaveBeenCalledTimes(0);
      expect(selectTask).toHaveBeenCalledWith("task-3");
      expect(globalThis.document.activeElement).toBe(nextTrigger);
    } finally {
      try {
        await harness.unmount();
      } finally {
        nextTrigger.remove();
      }
    }
  });

  test("closing the last active tab clears the current selection", async () => {
    const clearTaskSelection = mock(() => {});
    const selectTask = mock(() => {});
    const harness = createHookHarness({
      initialOpenTaskTabs: ["task-1"],
      initialPersistedActiveTaskId: "task-1",
      activeTaskTabId: "task-1",
      clearTaskSelection,
      selectTask,
      handleSelectTab: () => {},
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleCloseTab("task-1");
    });

    const latest = harness.getLatest();
    expect(latest.openTaskTabs).toEqual([]);
    expect(latest.persistedActiveTaskId).toBeNull();
    expect(typeof latest.handleReorderTab).toBe("function");
    expect(clearTaskSelection).toHaveBeenCalledTimes(1);
    expect(selectTask).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });

  test("reordering tabs updates order without changing active-tab side effects", async () => {
    const clearTaskSelection = mock(() => {});
    const selectTask = mock(() => {});
    const harness = createHookHarness({
      initialOpenTaskTabs: ["task-1", "task-2", "task-3"],
      initialPersistedActiveTaskId: "task-2",
      activeTaskTabId: "task-2",
      clearTaskSelection,
      selectTask,
      handleSelectTab: () => {},
    });

    await harness.mount();
    await harness.run((state) => {
      state.handleReorderTab("task-3", "task-1", "before");
    });

    expect(harness.getLatest()).toEqual({
      handleCreateTab: harness.getLatest().handleCreateTab,
      handleCloseTab: harness.getLatest().handleCloseTab,
      handleReorderTab: harness.getLatest().handleReorderTab,
      openTaskTabs: ["task-3", "task-1", "task-2"],
      persistedActiveTaskId: "task-2",
    });
    expect(clearTaskSelection).toHaveBeenCalledTimes(0);
    expect(selectTask).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });
});
