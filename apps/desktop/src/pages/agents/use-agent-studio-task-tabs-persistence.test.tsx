import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { useState } from "react";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import {
  createMemoryStorage,
  seedRepoTaskTabs,
  type TestStorageLike,
  withMockedLocalStorage,
} from "./agent-studio-repo-persistence-test-utils";
import { createTaskCardFixture, enableReactActEnvironment } from "./agent-studio-test-utils";
import { toTabsStorageKey } from "./agents-page-selection";
import { toPersistedTaskTabs } from "./agents-page-session-tabs";
import { useTaskTabPersistence } from "./use-agent-studio-task-tabs-persistence";

enableReactActEnvironment();

type HookArgs = Omit<
  Parameters<typeof useTaskTabPersistence>[0],
  | "openTaskTabs"
  | "tabsStorageHydratedRepo"
  | "setOpenTaskTabs"
  | "setPersistedActiveTaskId"
  | "setIntentActiveTaskId"
  | "setTabsStorageHydratedRepo"
> & {
  initialOpenTaskTabs?: string[];
  initialPersistedActiveTaskId?: string | null;
  initialIntentActiveTaskId?: string | null;
  initialTabsStorageHydratedRepo?: string | null;
};

const createTask = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createTaskCardFixture({
    id: "task-1",
    title: "Task 1",
    status: "in_progress",
    ...overrides,
  });

const createThrowingStorage = (args: {
  throwOnGetItem?: boolean;
  throwOnSetItem?: boolean;
  message?: string;
}): TestStorageLike => {
  const store = new Map<string, string>();
  const message = args.message ?? "storage unavailable";

  return {
    getItem: (key) => {
      if (args.throwOnGetItem) {
        throw new Error(message);
      }
      return store.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (args.throwOnSetItem) {
        throw new Error(message);
      }
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
};

const useTaskTabPersistenceHarness = (props: HookArgs) => {
  const [openTaskTabs, setOpenTaskTabs] = useState(props.initialOpenTaskTabs ?? []);
  const [persistedActiveTaskId, setPersistedActiveTaskId] = useState(
    props.initialPersistedActiveTaskId ?? null,
  );
  const [intentActiveTaskId, setIntentActiveTaskId] = useState(
    props.initialIntentActiveTaskId ?? null,
  );
  const [tabsStorageHydratedRepo, setTabsStorageHydratedRepo] = useState(
    props.initialTabsStorageHydratedRepo ?? null,
  );

  useTaskTabPersistence({
    activeRepo: props.activeRepo,
    taskId: props.taskId,
    selectedTask: props.selectedTask,
    tasks: props.tasks,
    isLoadingTasks: props.isLoadingTasks,
    activeTaskTabId: props.activeTaskTabId,
    openTaskTabs,
    tabsStorageHydratedRepo,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setIntentActiveTaskId,
    setTabsStorageHydratedRepo,
  });

  return {
    openTaskTabs,
    persistedActiveTaskId,
    intentActiveTaskId,
    tabsStorageHydratedRepo,
  };
};

const createHookHarness = (initialProps: HookArgs) =>
  createCoreHookHarness(useTaskTabPersistenceHarness, initialProps);

describe("useTaskTabPersistence", () => {
  test("resets tab state when the active repo is cleared", async () => {
    const harness = createHookHarness({
      activeRepo: null,
      taskId: "",
      selectedTask: null,
      tasks: [],
      isLoadingTasks: false,
      activeTaskTabId: "",
      initialOpenTaskTabs: ["task-1", "task-2"],
      initialPersistedActiveTaskId: "task-2",
      initialIntentActiveTaskId: "task-2",
      initialTabsStorageHydratedRepo: "/repo",
    });

    await harness.mount();

    expect(harness.getLatest()).toEqual({
      openTaskTabs: [],
      persistedActiveTaskId: null,
      intentActiveTaskId: null,
      tabsStorageHydratedRepo: null,
    });

    await harness.unmount();
  });

  test("hydrates repo-scoped tabs from the active repo storage key", async () => {
    const storage = createMemoryStorage();

    await withMockedLocalStorage(storage, async () => {
      seedRepoTaskTabs(storage, {
        "/repo-a": { tabs: ["task-a"], activeTaskId: "task-a" },
        "/repo-b": { tabs: ["task-b", "task-c"], activeTaskId: "task-c" },
      });

      const harness = createHookHarness({
        activeRepo: "/repo-b",
        taskId: "",
        selectedTask: null,
        tasks: [createTask({ id: "task-b" }), createTask({ id: "task-c" })],
        isLoadingTasks: false,
        activeTaskTabId: "",
      });

      await harness.mount();

      expect(harness.getLatest()).toEqual({
        openTaskTabs: ["task-b", "task-c"],
        persistedActiveTaskId: "task-c",
        intentActiveTaskId: null,
        tabsStorageHydratedRepo: "/repo-b",
      });

      await harness.unmount();
    });
  });

  test("persists task tabs only after hydration matches the active repo", async () => {
    const store = new Map<string, string>();
    const setItem = mock((key: string, value: string) => {
      store.set(key, value);
    });
    const storage: TestStorageLike = {
      getItem: (key) => store.get(key) ?? null,
      setItem,
      removeItem: (key) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    };

    await withMockedLocalStorage(storage, async () => {
      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "task-1",
        selectedTask: createTask({ id: "task-1" }),
        tasks: [createTask({ id: "task-1" })],
        isLoadingTasks: false,
        activeTaskTabId: "task-1",
        initialOpenTaskTabs: ["stale-task"],
        initialPersistedActiveTaskId: "stale-task",
        initialTabsStorageHydratedRepo: null,
      });

      await harness.mount();

      expect(setItem).toHaveBeenCalledTimes(1);
      expect(setItem).toHaveBeenCalledWith(
        toTabsStorageKey("/repo"),
        toPersistedTaskTabs({ tabs: ["task-1"], activeTaskId: "task-1" }),
      );
      expect(harness.getLatest()).toEqual({
        openTaskTabs: ["task-1"],
        persistedActiveTaskId: null,
        intentActiveTaskId: null,
        tabsStorageHydratedRepo: "/repo",
      });

      await harness.unmount();
    });
  });

  test("prunes closed task tabs after tasks finish loading", async () => {
    const storage = createMemoryStorage();

    await withMockedLocalStorage(storage, async () => {
      seedRepoTaskTabs(storage, {
        "/repo": { tabs: ["task-1", "task-closed"], activeTaskId: "task-1" },
      });

      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "",
        selectedTask: null,
        tasks: [
          createTask({ id: "task-1", status: "in_progress" }),
          createTask({ id: "task-closed", status: "closed" }),
        ],
        isLoadingTasks: true,
        activeTaskTabId: "task-1",
      });

      await harness.mount();
      expect(harness.getLatest().openTaskTabs).toEqual(["task-1", "task-closed"]);

      await harness.update({
        activeRepo: "/repo",
        taskId: "",
        selectedTask: null,
        tasks: [
          createTask({ id: "task-1", status: "in_progress" }),
          createTask({ id: "task-closed", status: "closed" }),
        ],
        isLoadingTasks: false,
        activeTaskTabId: "task-1",
      });

      expect(harness.getLatest().openTaskTabs).toEqual(["task-1"]);

      await harness.unmount();
    });
  });

  test("auto-opens the selected non-closed task when it is missing from the tab list", async () => {
    const storage = createMemoryStorage();

    await withMockedLocalStorage(storage, async () => {
      seedRepoTaskTabs(storage, {
        "/repo": { tabs: ["task-1"], activeTaskId: "task-1" },
      });

      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "task-2",
        selectedTask: createTask({ id: "task-2", status: "in_progress" }),
        tasks: [createTask({ id: "task-1" }), createTask({ id: "task-2" })],
        isLoadingTasks: false,
        activeTaskTabId: "task-2",
      });

      await harness.mount();

      expect(harness.getLatest().openTaskTabs).toEqual(["task-1", "task-2"]);

      await harness.unmount();
    });
  });

  test("throws an actionable error when reading task tabs storage fails", async () => {
    const storage = createThrowingStorage({
      throwOnGetItem: true,
      message: "read blocked",
    });

    await withMockedLocalStorage(storage, async () => {
      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "",
        selectedTask: null,
        tasks: [createTask({ id: "task-1" })],
        isLoadingTasks: false,
        activeTaskTabId: "",
      });

      await expect(harness.mount()).rejects.toThrow(
        `Failed to read agent studio task tabs storage key "${toTabsStorageKey("/repo")}": read blocked`,
      );
    });
  });

  test("throws an actionable error when persisting task tabs storage fails", async () => {
    const storage = createThrowingStorage({
      throwOnSetItem: true,
      message: "write blocked",
    });

    await withMockedLocalStorage(storage, async () => {
      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "task-1",
        selectedTask: createTask({ id: "task-1" }),
        tasks: [createTask({ id: "task-1" })],
        isLoadingTasks: false,
        activeTaskTabId: "task-1",
      });

      await expect(harness.mount()).rejects.toThrow(
        `Failed to persist agent studio task tabs storage key "${toTabsStorageKey("/repo")}": write blocked`,
      );
    });
  });
});
