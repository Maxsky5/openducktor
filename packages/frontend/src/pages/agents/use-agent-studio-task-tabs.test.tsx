import { describe, expect, test } from "bun:test";
import {
  createMemoryStorage,
  seedWorkspaceTaskTabs,
  type TestStorageLike,
  withMockedLocalStorage,
} from "./agent-studio-repo-persistence-test-utils";
import { parsePersistedTaskTabs, toPersistedTaskTabs } from "./agent-studio-task-tabs-storage";
import {
  createAgentSessionSummaryFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { toTabsStorageKey } from "./agents-page-selection";
import type { AgentStudioSelectionState } from "./shell/agent-studio-selection-state";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioTaskTabs>[0];

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

const createTask = (id: string) => createTaskCardFixture({ id, title: id });

const createSession = (taskId: string, externalSessionId: string) =>
  createAgentSessionSummaryFixture({
    externalSessionId: `ext-${externalSessionId}`,
    taskId,
  });

const taskSelection = (taskId: string): AgentStudioSelectionState => ({
  taskId,
  sessionExternalId: null,
  sessionIdentity: null,
  role: "spec",
  hasExplicitRoleSelection: false,
  keepSessionless: false,
});

const useTaskTabsHarness = (props: HookArgs) => useAgentStudioTaskTabs(props);

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useTaskTabsHarness, initialProps);

const withWorkspaceId = (
  overrides: Partial<HookArgs> & Pick<HookArgs, "activeWorkspaceId">,
): HookArgs => ({
  taskId: "",
  selectedTask: null,
  tasks: [],
  isLoadingTasks: false,
  latestSessionByTaskId: new Map(),
  selectAgentStudioSelection: () => {},
  ...overrides,
});

describe("useAgentStudioTaskTabs", () => {
  test("loads persisted task tabs from localStorage", async () => {
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
      memoryStorage.setItem(toTabsStorageKey("workspace-repo"), persistedValue);

      const updateCalls: AgentStudioSelectionState[] = [];
      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "task-1",
          selectedTask: createTask("task-1"),
          tasks: [createTask("task-1"), createTask("task-2")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map(),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

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

  test("selecting a tab keeps navigation task-scoped without pinning a session", async () => {
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
      const updateCalls: AgentStudioSelectionState[] = [];

      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "task-1",
          selectedTask: taskOne,
          tasks: [taskOne, taskTwo],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map([["task-2", latestSession]]),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await harness.mount();
      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });

      const lastUpdate = updateCalls[updateCalls.length - 1];
      expect(lastUpdate).toEqual(taskSelection("task-2"));

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("selecting a tab does not manufacture session authority for review tasks", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      const taskOne = createTask("task-1");
      const taskTwo = createTask("task-2");
      const runningBuildSession = createAgentSessionSummaryFixture({
        externalSessionId: "ext-session-build",
        taskId: "task-2",
        role: "build",
        status: "running",
        startedAt: "2026-02-22T09:00:00.000Z",
      });
      const newerIdleSession = createAgentSessionSummaryFixture({
        externalSessionId: "ext-session-newer",
        taskId: "task-2",
        role: "qa",
        status: "idle",
        startedAt: "2026-02-22T10:00:00.000Z",
      });
      const updateCalls: AgentStudioSelectionState[] = [];

      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "task-1",
          selectedTask: taskOne,
          tasks: [taskOne, taskTwo],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map([["task-2", newerIdleSession]]),
          activeSessionByTaskId: new Map([["task-2", runningBuildSession]]),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await harness.mount();
      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });

      expect(updateCalls[updateCalls.length - 1]).toEqual(taskSelection("task-2"));

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
        toTabsStorageKey("workspace-repo"),
        toPersistedTaskTabs({
          tabs: ["task-1", "task-2"],
          activeTaskId: "task-2",
        }),
      );

      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "task-1",
          selectedTask: createTask("task-1"),
          tasks: [createTask("task-1"), createTask("task-2")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map(),
          selectAgentStudioSelection: () => {},
        }),
      );

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
        toTabsStorageKey("workspace-repo"),
        toPersistedTaskTabs({
          tabs: ["task-1", "task-2"],
          activeTaskId: "task-2",
        }),
      );

      const taskOne = createTask("task-1");
      const taskTwo = createTask("task-2");
      const updateCalls: AgentStudioSelectionState[] = [];

      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "task-1",
          selectedTask: taskOne,
          tasks: [taskOne, taskTwo],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map([["task-1", createSession("task-1", "session-1")]]),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await harness.mount();
      expect(harness.getLatest().activeTaskTabId).toBe("task-1");

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });
      expect(updateCalls[updateCalls.length - 1]).toEqual(taskSelection("task-2"));

      await harness.update(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "task-2",
          selectedTask: taskTwo,
          tasks: [taskOne, taskTwo],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map([["task-1", createSession("task-1", "session-1")]]),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );
      expect(harness.getLatest().activeTaskTabId).toBe("task-2");

      await harness.run((state) => {
        state.handleCloseTab("task-2");
      });

      const lastUpdate = updateCalls[updateCalls.length - 1];
      expect(lastUpdate).toEqual(taskSelection("task-1"));
      await harness.update(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "task-1",
          selectedTask: taskOne,
          tasks: [taskOne, taskTwo],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map([["task-1", createSession("task-1", "session-1")]]),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      expect(harness.getLatest().tabTaskIds).toEqual(["task-1"]);

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("reordering tabs updates persisted order without changing the active task", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      seedWorkspaceTaskTabs(memoryStorage, {
        "workspace-repo": {
          tabs: ["task-1", "task-2", "task-3"],
          activeTaskId: "task-2",
        },
      });

      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "task-2",
          selectedTask: createTask("task-2"),
          tasks: [createTask("task-1"), createTask("task-2"), createTask("task-3")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map(),
          selectAgentStudioSelection: () => {},
        }),
      );

      await harness.mount();
      await harness.run((state) => {
        state.handleReorderTab("task-3", "task-1", "before");
      });

      expect(harness.getLatest().tabTaskIds).toEqual(["task-3", "task-1", "task-2"]);
      expect(harness.getLatest().activeTaskTabId).toBe("task-2");
      expect(
        parsePersistedTaskTabs(memoryStorage.getItem(toTabsStorageKey("workspace-repo"))),
      ).toEqual({
        tabs: ["task-3", "task-1", "task-2"],
        activeTaskId: "task-2",
      });

      await harness.unmount();
    });
  });

  test("routes fallback tab after storage is loaded when URL task is empty", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(
        toTabsStorageKey("workspace-repo"),
        toPersistedTaskTabs({
          tabs: ["task-2"],
          activeTaskId: "task-2",
        }),
      );

      const latestSession = createSession("task-2", "session-2");
      const updateCalls: AgentStudioSelectionState[] = [];

      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "",
          selectedTask: null,
          tasks: [createTask("task-1"), createTask("task-2")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map([["task-2", latestSession]]),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await harness.mount();
      await harness.waitFor(() => updateCalls.length > 0);

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]).toEqual(taskSelection("task-2"));

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
        toTabsStorageKey("workspace-repo"),
        toPersistedTaskTabs({
          tabs: ["task-2"],
          activeTaskId: "task-2",
        }),
      );

      const updateCalls: AgentStudioSelectionState[] = [];
      const latestSession = createSession("task-2", "session-2");
      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "",
          selectedTask: null,
          tasks: [createTask("task-2")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map([["task-2", latestSession]]),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await harness.mount();
      await harness.waitFor(() => updateCalls.length === 1);

      await harness.update({
        activeWorkspaceId: "workspace-repo",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-2")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-2", latestSession]]),
        selectAgentStudioSelection: (updates) => {
          updateCalls.push(updates);
        },
      });

      await harness.update({
        activeWorkspaceId: "workspace-repo",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-2")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-2", latestSession]]),
        selectAgentStudioSelection: (updates) => {
          updateCalls.push(updates);
        },
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
        toTabsStorageKey("workspace-repo-b"),
        toPersistedTaskTabs({
          tabs: ["task-b"],
          activeTaskId: "task-b",
        }),
      );

      const updateCalls: AgentStudioSelectionState[] = [];
      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo-a",
          taskId: "task-a",
          selectedTask: createTask("task-a"),
          tasks: [createTask("task-a")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map(),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await harness.mount();
      expect(updateCalls).toHaveLength(0);

      const repoBSession = createSession("task-b", "session-b");
      await harness.update({
        activeWorkspaceId: "workspace-repo-b",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-b")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-b", repoBSession]]),
        selectAgentStudioSelection: (updates) => {
          updateCalls.push(updates);
        },
      });

      await harness.waitFor(() => updateCalls.length > 0);

      expect(updateCalls[0]).toEqual(taskSelection("task-b"));
      expect(updateCalls.some((call) => call.taskId === "task-a")).toBeFalse();

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("suppresses fallback routing while repo navigation boundary is pending", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      memoryStorage.setItem(
        toTabsStorageKey("workspace-repo-b"),
        toPersistedTaskTabs({
          tabs: ["task-b"],
          activeTaskId: "task-b",
        }),
      );

      const updateCalls: AgentStudioSelectionState[] = [];
      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo-b",
          isRepoNavigationBoundaryPending: true,
          taskId: "",
          selectedTask: null,
          tasks: [createTask("task-b")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map([["task-b", createSession("task-b", "session-b")]]),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await harness.mount();

      expect(updateCalls).toHaveLength(0);
      expect(harness.getLatest().activeTaskTabId).toBe("task-b");

      await harness.unmount();
    });
  });

  test("restores repo-scoped fallback tabs when switching away and back", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      seedWorkspaceTaskTabs(memoryStorage, {
        "workspace-repo-a": { tabs: ["task-a"], activeTaskId: "task-a" },
        "workspace-repo-b": { tabs: ["task-b"], activeTaskId: "task-b" },
      });

      const updateCalls: AgentStudioSelectionState[] = [];
      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo-a",
          taskId: "",
          selectedTask: null,
          tasks: [createTask("task-a")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map([["task-a", createSession("task-a", "session-a")]]),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await harness.mount();
      await harness.waitFor(() => updateCalls.length === 1);

      await harness.update({
        activeWorkspaceId: "workspace-repo-b",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-b")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-b", createSession("task-b", "session-b")]]),
        selectAgentStudioSelection: (updates) => {
          updateCalls.push(updates);
        },
      });
      await harness.waitFor(() => updateCalls.length === 2);

      await harness.update({
        activeWorkspaceId: "workspace-repo-a",
        taskId: "",
        selectedTask: null,
        tasks: [createTask("task-a")],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map([["task-a", createSession("task-a", "session-a-2")]]),
        selectAgentStudioSelection: (updates) => {
          updateCalls.push(updates);
        },
      });
      await harness.waitFor(() => updateCalls.length === 3);

      expect(updateCalls.map((call) => call.taskId)).toEqual(["task-a", "task-b", "task-a"]);

      await harness.unmount();
    });
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
        toTabsStorageKey("workspace-repo"),
        toPersistedTaskTabs({
          tabs: ["task-1", "task-2"],
          activeTaskId: "task-2",
        }),
      );

      const taskOne = createTask("task-1");
      const taskTwo = createTask("task-2");
      const latestSession = createSession("task-1", "session-1");
      const updateCalls: AgentStudioSelectionState[] = [];
      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "task-2",
          selectedTask: taskTwo,
          tasks: [taskOne, taskTwo],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map([["task-1", latestSession]]),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await harness.mount();
      expect(harness.getLatest().tabTaskIds).toEqual(["task-1", "task-2"]);

      await harness.update({
        activeWorkspaceId: "workspace-repo",
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
        selectAgentStudioSelection: (updates) => {
          updateCalls.push(updates);
        },
      });

      await harness.waitFor(() => updateCalls.length > 0);

      expect(harness.getLatest().tabTaskIds).toEqual(["task-1"]);
      expect(harness.getLatest().activeTaskTabId).toBe("task-1");
      expect(updateCalls[0]).toEqual(taskSelection("task-1"));

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
        toTabsStorageKey("workspace-repo"),
        toPersistedTaskTabs({
          tabs: ["task-1"],
          activeTaskId: "task-1",
        }),
      );

      const updateCalls: AgentStudioSelectionState[] = [];
      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "",
          selectedTask: null,
          tasks: [createTask("task-1")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map(),
          selectAgentStudioSelection: (updates) => {
            updateCalls.push(updates);
          },
        }),
      );

      await harness.mount();
      await harness.waitFor(() => updateCalls.length > 0);
      updateCalls.length = 0;

      await harness.update({
        activeWorkspaceId: null,
        taskId: "",
        selectedTask: null,
        tasks: [],
        isLoadingTasks: false,
        latestSessionByTaskId: new Map(),
        selectAgentStudioSelection: (updates) => {
          updateCalls.push(updates);
        },
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
      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "",
          selectedTask: null,
          tasks: [createTask("task-1")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map(),
          selectAgentStudioSelection: () => {},
        }),
      );

      await expect(harness.mount()).rejects.toThrow(
        `Failed to read agent studio task tabs storage key "${toTabsStorageKey("workspace-repo")}": read blocked`,
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
      const harness = createHookHarness(
        withWorkspaceId({
          activeWorkspaceId: "workspace-repo",
          taskId: "task-1",
          selectedTask: createTask("task-1"),
          tasks: [createTask("task-1")],
          isLoadingTasks: false,
          latestSessionByTaskId: new Map(),
          selectAgentStudioSelection: () => {},
        }),
      );

      await expect(harness.mount()).rejects.toThrow(
        `Failed to persist agent studio task tabs storage key "${toTabsStorageKey("workspace-repo")}": write blocked`,
      );
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });
});
