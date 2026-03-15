import { describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { toTabsStorageKey } from "./agents-page-selection";
import { toPersistedTaskTabs } from "./agents-page-session-tabs";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioTaskTabs>[0];

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

const createThrowingStorage = (args: {
  throwOnGetItem?: boolean;
  throwOnSetItem?: boolean;
  message?: string;
}): StorageLike => {
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

  test("explicit URL task takes precedence over persisted tab when there is no local switch intent", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(
        toTabsStorageKey("/repo"),
        toPersistedTaskTabs({
          tabs: ["task-1", "task-2"],
          activeTaskId: "task-2",
        }),
      );

      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "task-1",
        selectedTask: createTask("task-1"),
        tasks: [createTask("task-1"), createTask("task-2")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map(),
        updateQuery: () => {},
        clearComposerInput: () => {},
      });

      await harness.mount();
      expect(harness.getLatest().activeTaskTabId).toBe("task-1");
      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("closing the UI-active tab uses activeTaskTabId even when URL task differs", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(
        toTabsStorageKey("/repo"),
        toPersistedTaskTabs({
          tabs: ["task-1", "task-2"],
          activeTaskId: "task-2",
        }),
      );

      const taskOne = createTask("task-1");
      const taskTwo = createTask("task-2");
      const fallbackSession = createSession("task-1", "session-1");
      const updateCalls: Array<Record<string, string | undefined>> = [];
      const clearComposerInput = mock(() => {});

      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "task-1",
        selectedTask: taskOne,
        tasks: [taskOne, taskTwo],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-1", fallbackSession]]),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput,
      });

      await harness.mount();
      expect(harness.getLatest().activeTaskTabId).toBe("task-1");

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });
      expect(harness.getLatest().activeTaskTabId).toBe("task-2");

      await harness.run((state) => {
        state.handleCloseTab("task-2");
      });

      expect(clearComposerInput).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().tabTaskIds).toEqual(["task-1"]);
      const lastUpdate = updateCalls[updateCalls.length - 1];
      expect(lastUpdate).toEqual({
        task: "task-1",
        session: "session-1",
        agent: "spec",
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

  test("routes fallback tab after hydration when URL task is empty", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(
        toTabsStorageKey("/repo"),
        toPersistedTaskTabs({
          tabs: ["task-2"],
          activeTaskId: "task-2",
        }),
      );

      const latestSession = createSession("task-2", "session-2");
      const updateCalls: Array<Record<string, string | undefined>> = [];

      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-1"), createTask("task-2")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-2", latestSession]]),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      await harness.mount();
      await harness.waitFor(() => updateCalls.length > 0);

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]).toEqual({
        task: "task-2",
        session: "session-2",
        agent: "spec",
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

  test("applies fallback routing only once for an unchanged fallback target", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(
        toTabsStorageKey("/repo"),
        toPersistedTaskTabs({
          tabs: ["task-2"],
          activeTaskId: "task-2",
        }),
      );

      const updateCalls: Array<Record<string, string | undefined>> = [];
      const latestSession = createSession("task-2", "session-2");
      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-2")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-2", latestSession]]),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      await harness.mount();
      await harness.waitFor(() => updateCalls.length === 1);

      await harness.update({
        activeRepo: "/repo",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-2")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-2", latestSession]]),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      await harness.update({
        activeRepo: "/repo",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-2")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-2", latestSession]]),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      expect(updateCalls).toHaveLength(1);

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("does not route stale fallback tab while switching repos", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(
        toTabsStorageKey("/repo-b"),
        toPersistedTaskTabs({
          tabs: ["task-b"],
          activeTaskId: "task-b",
        }),
      );

      const updateCalls: Array<Record<string, string | undefined>> = [];
      const harness = createHookHarness({
        activeRepo: "/repo-a",
        taskId: "task-a",
        selectedTask: createTask("task-a"),
        tasks: [createTask("task-a")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map(),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      await harness.mount();
      expect(updateCalls).toHaveLength(0);

      const repoBSession = createSession("task-b", "session-b");
      await harness.update({
        activeRepo: "/repo-b",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-b")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-b", repoBSession]]),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      await harness.waitFor(() => updateCalls.length > 0);

      expect(updateCalls[0]).toEqual({
        task: "task-b",
        session: "session-b",
        agent: "spec",
        autostart: undefined,
        start: undefined,
      });
      expect(updateCalls.some((call) => call.task === "task-a")).toBeFalse();

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("removes a task tab when the selected task becomes closed and routes to the first remaining tab", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(
        toTabsStorageKey("/repo"),
        toPersistedTaskTabs({
          tabs: ["task-1", "task-2"],
          activeTaskId: "task-2",
        }),
      );

      const taskOne = createTask("task-1");
      const taskTwo = createTask("task-2");
      const latestSession = createSession("task-1", "session-1");
      const updateCalls: Array<Record<string, string | undefined>> = [];
      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "task-2",
        selectedTask: taskTwo,
        tasks: [taskOne, taskTwo],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-1", latestSession]]),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      await harness.mount();
      expect(harness.getLatest().tabTaskIds).toEqual(["task-1", "task-2"]);

      await harness.update({
        activeRepo: "/repo",
        taskId: "task-2",
        selectedTask: createTaskCardFixture({
          id: "task-2",
          title: "task-2",
          status: "closed",
        }),
        tasks: [
          taskOne,
          createTaskCardFixture({
            id: "task-2",
            title: "task-2",
            status: "closed",
          }),
        ],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-1", latestSession]]),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      await harness.waitFor(() => updateCalls.length > 0);

      expect(harness.getLatest().tabTaskIds).toEqual(["task-1"]);
      expect(harness.getLatest().activeTaskTabId).toBe("task-1");
      expect(updateCalls[0]).toEqual({
        task: "task-1",
        session: "session-1",
        agent: "spec",
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

  test("clearing active repo skips fallback routing and resets tabs", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(
        toTabsStorageKey("/repo"),
        toPersistedTaskTabs({
          tabs: ["task-1"],
          activeTaskId: "task-1",
        }),
      );

      const updateCalls: Array<Record<string, string | undefined>> = [];
      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-1")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map(),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      await harness.mount();
      await harness.waitFor(() => updateCalls.length > 0);
      updateCalls.length = 0;

      await harness.update({
        activeRepo: null,
        taskId: "",
        selectedTask: null,
        tasks: [],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map(),
        updateQuery: (updates) => {
          updateCalls.push(updates);
        },
        clearComposerInput: () => {},
      });

      expect(updateCalls).toHaveLength(0);
      expect(harness.getLatest().tabTaskIds).toEqual([]);

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("throws actionable error when task tabs storage read fails", async () => {
    const throwingStorage = createThrowingStorage({
      throwOnGetItem: true,
      message: "read blocked",
    });
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: throwingStorage,
    });

    try {
      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-1")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map(),
        updateQuery: () => {},
        clearComposerInput: () => {},
      });

      await expect(harness.mount()).rejects.toThrow(
        `Failed to read agent studio task tabs storage key "${toTabsStorageKey("/repo")}": read blocked`,
      );
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("throws actionable error when task tabs storage persistence fails", async () => {
    const throwingStorage = createThrowingStorage({
      throwOnSetItem: true,
      message: "write blocked",
    });
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: throwingStorage,
    });

    try {
      const harness = createHookHarness({
        activeRepo: "/repo",
        taskId: "task-1",
        selectedTask: createTask("task-1"),
        tasks: [createTask("task-1")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map(),
        updateQuery: () => {},
        clearComposerInput: () => {},
      });

      await expect(harness.mount()).rejects.toThrow(
        `Failed to persist agent studio task tabs storage key "${toTabsStorageKey("/repo")}": write blocked`,
      );
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });
});
