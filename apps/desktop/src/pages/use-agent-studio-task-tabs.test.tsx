import { describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { toPersistedTaskTabs } from "./agents-page-session-tabs";
import { toTabsStorageKey } from "./agents-page-utils";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioTaskTabs>[0];
type HookState = ReturnType<typeof useAgentStudioTaskTabs>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear" | "key"> & {
  readonly length: number;
};

const createMemoryStorage = (): StorageLike => {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
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

const createTask = (id: string) => createTaskCardFixture({ id, title: id });

const createSession = (taskId: string, sessionId: string) =>
  createAgentSessionFixture({
    sessionId,
    externalSessionId: `ext-${sessionId}`,
    taskId,
  });

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioTaskTabs, initialProps);

describe("useAgentStudioTaskTabs", () => {
  test("hydrates persisted task tabs from localStorage", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      const persistedValue = toPersistedTaskTabs({
        tabs: ["task-1", "task-2"],
        activeTaskId: "task-1",
      });
      memoryStorage.setItem(toTabsStorageKey("/repo"), persistedValue);

      const updateCalls: Array<Record<string, string | undefined>> = [];
      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "task-1",
        selectedTask: createTask("task-1"),
        tasks: [createTask("task-1"), createTask("task-2")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map(),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      await harness.mount();

      expect(harness.getLatest().tabTaskIds).toEqual(["task-1", "task-2"]);
      expect(harness.getLatest().taskTabs).toHaveLength(2);
      expect(updateCalls).toHaveLength(0);

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("selecting a tab routes to latest session when available", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      const taskOne = createTask("task-1");
      const taskTwo = createTask("task-2");
      const latestSession = createSession("task-2", "session-2");
      const updateCalls: Array<Record<string, string | undefined>> = [];
      const clearComposerInput = mock(() => {});

      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "task-1",
        selectedTask: taskOne,
        tasks: [taskOne, taskTwo],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-2", latestSession]]),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput,
      });

      await harness.mount();
      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });

      expect(clearComposerInput).toHaveBeenCalledTimes(1);
      const lastUpdate = updateCalls[updateCalls.length - 1];
      expect(lastUpdate).toEqual({
        task: "task-2",
        session: "session-2",
        agent: "spec",
        scenario: "spec_initial",
        autostart: undefined,
        start: undefined,
      });

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });
});
