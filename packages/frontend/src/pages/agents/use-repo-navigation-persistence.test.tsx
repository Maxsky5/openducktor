import { describe, expect, test } from "bun:test";
import { useState } from "react";
import {
  createMemoryStorage,
  seedWorkspaceNavigationContexts,
  type TestStorageLike,
  withMockedLocalStorage,
} from "./agent-studio-repo-persistence-test-utils";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import {
  type AgentStudioNavigationState,
  toContextStorageKey,
} from "./query-sync/agent-studio-navigation";
import {
  resolveRepoNavigationBoundaryPhase,
  useRepoNavigationPersistence,
} from "./use-repo-navigation-persistence";

enableReactActEnvironment();

type HookArgs = {
  activeWorkspaceId: string | null;
  initialNavigation?: AgentStudioNavigationState;
};

const sessionExternalIdParam = (sessionExternalId: string) => sessionExternalId;

const createRecordingStorage = () => {
  const store = new Map<string, string>();
  const writes: Array<{ key: string; value: string }> = [];

  const storage: TestStorageLike = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      writes.push({ key, value });
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

  return { storage, writes };
};

const createThrowingStorage = (args: {
  throwOnGetItem?: boolean;
  throwOnSetItem?: boolean;
  message?: string;
}): TestStorageLike => {
  const store = new Map<string, string>();
  const message = args.message ?? "storage unavailable";
  return {
    getItem: (key: string) => {
      if (args.throwOnGetItem) {
        throw new Error(message);
      }
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (args.throwOnSetItem) {
        throw new Error(message);
      }
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
};

const useHookHarness = ({ activeWorkspaceId, initialNavigation }: HookArgs) => {
  const [navigation, setNavigation] = useState<AgentStudioNavigationState>(
    initialNavigation ?? {
      taskId: "",
      sessionExternalId: null,
      role: null,
    },
  );

  const { isRepoNavigationBoundaryPending, persistenceError, retryPersistenceRestore } =
    useRepoNavigationPersistence({
      activeWorkspaceId,
      navigation,
      setNavigation,
    });

  return {
    navigation,
    isRepoNavigationBoundaryPending,
    persistenceError,
    retryPersistenceRestore,
    setNavigation,
  };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useHookHarness, initialProps);

describe("useRepoNavigationPersistence", () => {
  test("treats the first render after a repo change as boundary-pending before effects run", () => {
    expect(
      resolveRepoNavigationBoundaryPhase({
        activeWorkspaceId: "repo-b",
        lastWorkspaceId: "repo-a",
        boundaryWorkspaceId: null,
      }),
    ).toBe("detecting");
    expect(
      resolveRepoNavigationBoundaryPhase({
        activeWorkspaceId: "repo-a",
        lastWorkspaceId: "repo-a",
        boundaryWorkspaceId: null,
      }),
    ).toBe("idle");
  });

  test("restores persisted repo context when navigation has no explicit task selection", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(
        toContextStorageKey("workspace-repo"),
        JSON.stringify({
          taskId: "task-from-context",
          role: "planner",
          sessionExternalId: "session-from-context",
        }),
      );

      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo",
      });

      await harness.mount();
      await harness.waitFor((state) => state.navigation.taskId === "task-from-context");

      expect(harness.getLatest().navigation).toMatchObject({
        taskId: "task-from-context",
        sessionExternalId: sessionExternalIdParam("session-from-context"),
        role: "planner",
      });

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("does not override explicit role-only selection with persisted repo context", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      seedWorkspaceNavigationContexts(memoryStorage, {
        "workspace-repo": {
          taskId: "task-from-context",
          role: "qa",
          sessionExternalId: "session-from-context",
        },
      });

      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo",
        initialNavigation: {
          taskId: "",
          sessionExternalId: null,
          role: "planner",
        },
      });

      await harness.mount();

      expect(harness.getLatest().navigation).toEqual({
        taskId: "",
        sessionExternalId: null,
        role: "planner",
      });

      await harness.unmount();
    });
  });

  test("flushes pending persistence during unmount cleanup", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo",
      });

      await harness.mount();
      await harness.run((latest) => {
        latest.setNavigation({
          taskId: "task-from-cleanup",
          sessionExternalId: sessionExternalIdParam("session-from-cleanup"),
          role: "spec",
        });
      });

      await harness.unmount();

      const stored = memoryStorage.getItem(toContextStorageKey("workspace-repo"));
      if (!stored) {
        throw new Error("Expected persisted context payload after unmount cleanup");
      }

      expect(JSON.parse(stored)).toEqual({
        taskId: "task-from-cleanup",
        role: "spec",
        sessionExternalId: "session-from-cleanup",
      });
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("persists a null role without synthesizing spec", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo",
      });

      await harness.mount();
      await harness.run((latest) => {
        latest.setNavigation({
          taskId: "task-without-role",
          sessionExternalId: sessionExternalIdParam("session-without-role"),
          role: null,
        });
      });

      await harness.unmount();

      const stored = memoryStorage.getItem(toContextStorageKey("workspace-repo"));
      if (!stored) {
        throw new Error("Expected persisted context payload");
      }

      expect(JSON.parse(stored)).toEqual({
        taskId: "task-without-role",
        sessionExternalId: "session-without-role",
      });
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("surfaces malformed persisted context as retryable error", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(toContextStorageKey("workspace-repo"), "{not-json");

      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo",
      });

      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.persistenceError?.message.includes(
            "Failed to parse persisted agent studio context",
          ) === true,
      );

      expect(harness.getLatest().navigation).toEqual({
        taskId: "",
        sessionExternalId: null,
        role: null,
      });

      memoryStorage.setItem(
        toContextStorageKey("workspace-repo"),
        JSON.stringify({
          taskId: "task-from-context",
          role: "planner",
          sessionExternalId: "session-from-context",
        }),
      );

      await harness.run((latest) => {
        latest.retryPersistenceRestore();
      });
      await harness.waitFor((state) => state.navigation.taskId === "task-from-context");

      expect(harness.getLatest().persistenceError).toBeNull();
      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("surfaces actionable error when context storage read fails", async () => {
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: createThrowingStorage({
        throwOnGetItem: true,
        message: "read blocked",
      }),
    });

    try {
      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo",
      });

      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.persistenceError?.message ===
          `Failed to read agent studio context storage key "${toContextStorageKey("workspace-repo")}": read blocked`,
      );

      expect(harness.getLatest().persistenceError?.message).toBe(
        `Failed to read agent studio context storage key "${toContextStorageKey("workspace-repo")}": read blocked`,
      );
      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("clears restore error when active repository changes", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(toContextStorageKey("workspace-repo-a"), "{not-json");
      memoryStorage.setItem(
        toContextStorageKey("workspace-repo-b"),
        JSON.stringify({
          taskId: "task-from-repo-b",
          role: "planner",
          sessionExternalId: "session-from-repo-b",
        }),
      );

      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo-a",
      });

      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.persistenceError?.message.includes(
            "Failed to parse persisted agent studio context",
          ) === true,
      );

      await harness.update({
        activeWorkspaceId: "workspace-repo-b",
      });
      await harness.waitFor((state) => state.navigation.taskId === "task-from-repo-b");

      expect(harness.getLatest().persistenceError).toBeNull();
      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("clears stale repo navigation before restoring and persisting the next repo context", async () => {
    const { storage, writes } = createRecordingStorage();
    await withMockedLocalStorage(storage, async () => {
      storage.setItem(
        toContextStorageKey("workspace-repo-b"),
        JSON.stringify({
          taskId: "task-b",
          role: "planner",
          sessionExternalId: "session-b",
        }),
      );

      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo-a",
        initialNavigation: {
          taskId: "task-a",
          sessionExternalId: sessionExternalIdParam("session-a"),
          role: "build",
        },
      });

      await harness.mount();

      await harness.update({
        activeWorkspaceId: "workspace-repo-b",
      });

      await harness.waitFor((state) => state.navigation.taskId === "task-b");

      expect(harness.getLatest().isRepoNavigationBoundaryPending).toBeFalse();
      expect(harness.getLatest().navigation).toEqual({
        taskId: "task-b",
        sessionExternalId: sessionExternalIdParam("session-b"),
        role: "planner",
      });

      const repoBWrites = writes.filter(
        (entry) => entry.key === toContextStorageKey("workspace-repo-b"),
      );
      expect(repoBWrites.some((entry) => entry.value.includes("task-a"))).toBeFalse();
      expect(repoBWrites.some((entry) => entry.value.includes("session-a"))).toBeFalse();

      await harness.unmount();
    });
  });

  test("restores repo-scoped context when switching back to a previous repository", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      seedWorkspaceNavigationContexts(memoryStorage, {
        "workspace-repo-a": { taskId: "task-a", role: "spec", sessionExternalId: "session-a" },
        "workspace-repo-b": { taskId: "task-b", role: "planner", sessionExternalId: "session-b" },
      });

      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo-a",
      });

      await harness.mount();
      await harness.waitFor((state) => state.navigation.taskId === "task-a");

      await harness.update({
        activeWorkspaceId: "workspace-repo-b",
      });
      await harness.waitFor((state) => state.navigation.taskId === "task-b");

      await harness.update({
        activeWorkspaceId: "workspace-repo-a",
      });
      await harness.waitFor((state) => state.navigation.taskId === "task-a");

      expect(harness.getLatest().navigation).toEqual({
        taskId: "task-a",
        sessionExternalId: sessionExternalIdParam("session-a"),
        role: "spec",
      });

      await harness.unmount();
    });
  });

  test("rapid repo changes leave the final repository context restored", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      seedWorkspaceNavigationContexts(memoryStorage, {
        "workspace-repo-a": { taskId: "task-a", role: "spec", sessionExternalId: "session-a" },
        "workspace-repo-b": { taskId: "task-b", role: "planner", sessionExternalId: "session-b" },
      });

      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo-a",
      });

      await harness.mount();
      await harness.waitFor((state) => state.navigation.taskId === "task-a");

      await harness.update({
        activeWorkspaceId: "workspace-repo-b",
      });
      await harness.update({
        activeWorkspaceId: "workspace-repo-a",
      });
      await harness.waitFor((state) => state.navigation.taskId === "task-a");

      expect(harness.getLatest().navigation).toEqual({
        taskId: "task-a",
        sessionExternalId: sessionExternalIdParam("session-a"),
        role: "spec",
      });

      await harness.unmount();
    });
  });

  test("surfaces actionable error when context storage persistence fails and allows retry", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let nextTimerId = 1;
    const scheduledCallbacks = new Map<number, () => void>();

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });
    globalThis.setTimeout = ((callback: TimerHandler) => {
      const timerId = nextTimerId++;
      if (typeof callback !== "function") {
        throw new Error("Expected function timer callback");
      }
      scheduledCallbacks.set(timerId, callback as () => void);
      return timerId as unknown as ReturnType<typeof globalThis.setTimeout>;
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((timerId?: ReturnType<typeof globalThis.setTimeout>) => {
      if (typeof timerId === "number") {
        scheduledCallbacks.delete(timerId);
      }
    }) as unknown as typeof globalThis.clearTimeout;
    const takeLatestScheduledCallback = (message: string): (() => void) => {
      const latestEntry = [...scheduledCallbacks.entries()].at(-1);
      if (!latestEntry) {
        throw new Error(message);
      }
      const [timerId, callback] = latestEntry;
      scheduledCallbacks.delete(timerId);
      return callback;
    };

    try {
      const harness = createHookHarness({
        activeWorkspaceId: "workspace-repo",
      });

      await harness.mount();
      const initialFlush = takeLatestScheduledCallback(
        "Expected initial persistence callback to be scheduled",
      );
      initialFlush();

      await harness.run((latest) => {
        latest.setNavigation({
          taskId: "task-from-cleanup",
          sessionExternalId: sessionExternalIdParam("session-from-cleanup"),
          role: "spec",
        });
      });

      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: createThrowingStorage({
          throwOnSetItem: true,
          message: "write blocked",
        }),
      });

      const pendingFlush = takeLatestScheduledCallback(
        "Expected pending persistence callback to be scheduled",
      );

      await harness.run(() => {
        pendingFlush();
      });

      await harness.waitFor(
        (state) =>
          state.persistenceError?.message ===
          `Failed to persist agent studio context storage key "${toContextStorageKey("workspace-repo")}": write blocked`,
      );

      expect(harness.getLatest().persistenceError?.message).toBe(
        `Failed to persist agent studio context storage key "${toContextStorageKey("workspace-repo")}": write blocked`,
      );

      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: memoryStorage,
      });

      await harness.run((latest) => {
        latest.retryPersistenceRestore();
      });

      const retryFlush = takeLatestScheduledCallback(
        "Expected retry persistence callback to be scheduled",
      );
      await harness.run(() => {
        retryFlush();
      });

      await harness.waitFor((state) => state.persistenceError === null);

      const stored = memoryStorage.getItem(toContextStorageKey("workspace-repo"));
      if (!stored) {
        throw new Error("Expected persisted context payload after retry");
      }

      expect(JSON.parse(stored)).toEqual({
        taskId: "task-from-cleanup",
        role: "spec",
        sessionExternalId: "session-from-cleanup",
      });
      expect(harness.getLatest().persistenceError).toBeNull();

      await harness.unmount();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });
});
