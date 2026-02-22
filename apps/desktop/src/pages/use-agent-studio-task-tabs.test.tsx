import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskCard } from "@openducktor/contracts";
import { type ReactElement, createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { toPersistedTaskTabs } from "./agents-page-session-tabs";
import { toTabsStorageKey } from "./agents-page-utils";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

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

const createTask = (id: string): TaskCard => ({
  id,
  title: id,
  description: "",
  acceptanceCriteria: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  parentId: undefined,
  subtaskIds: [],
  assignee: undefined,
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false },
  },
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
});

const createSession = (taskId: string, sessionId: string): AgentSessionState => ({
  sessionId,
  externalSessionId: `ext-${sessionId}`,
  taskId,
  role: "spec",
  scenario: "spec_initial",
  status: "idle",
  startedAt: "2026-02-22T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  baseUrl: "http://localhost:4000",
  workingDirectory: "/repo",
  messages: [],
  draftAssistantText: "",
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createHookHarness = (initialProps: HookArgs) => {
  let latest: HookState | null = null;
  const currentProps = initialProps;

  const Harness = (props: HookArgs): ReactElement | null => {
    latest = useAgentStudioTaskTabs(props);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness, currentProps));
      await flush();
    });
  };

  const run = async (fn: (state: HookState) => void | Promise<void>): Promise<void> => {
    await act(async () => {
      if (!latest) {
        throw new Error("Hook state unavailable");
      }
      await fn(latest);
      await flush();
    });
  };

  const getLatest = (): HookState => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    return latest;
  };

  const unmount = async (): Promise<void> => {
    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  };

  return { mount, run, getLatest, unmount };
};

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
        autostart: undefined,
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
