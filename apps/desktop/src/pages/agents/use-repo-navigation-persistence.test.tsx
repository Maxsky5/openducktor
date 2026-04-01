import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { type AgentStudioNavigationState, toContextStorageKey } from "./agent-studio-navigation";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useRepoNavigationPersistence } from "./use-repo-navigation-persistence";

enableReactActEnvironment();

type HookArgs = {
  activeRepo: string | null;
  initialNavigation?: AgentStudioNavigationState;
};

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

const createRecordingStorage = () => {
  const store = new Map<string, string>();
  const writes: Array<{ key: string; value: string }> = [];

  const storage: StorageLike = {
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

const useHookHarness = ({ activeRepo, initialNavigation }: HookArgs) => {
  const [navigation, setNavigation] = useState<AgentStudioNavigationState>(
    initialNavigation ?? {
      taskId: "",
      sessionId: null,
      role: null,
      scenario: null,
    },
  );

  const { isRepoNavigationBoundaryPending, persistenceError, retryPersistenceRestore } =
    useRepoNavigationPersistence({
      activeRepo,
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
  test("restores persisted repo context when navigation has no explicit task selection", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      memoryStorage.setItem(
        toContextStorageKey("/repo"),
        JSON.stringify({
          taskId: "task-from-context",
          role: "planner",
          sessionId: "session-from-context",
        }),
      );

      const harness = createHookHarness({
        activeRepo: "/repo",
      });

      await harness.mount();
      await harness.waitFor((state) => state.navigation.taskId === "task-from-context");

      expect(harness.getLatest().navigation).toMatchObject({
        taskId: "task-from-context",
        sessionId: "session-from-context",
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

  test("flushes pending persistence during unmount cleanup", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      const harness = createHookHarness({
        activeRepo: "/repo",
      });

      await harness.mount();
      await harness.run((latest) => {
        latest.setNavigation({
          taskId: "task-from-cleanup",
          sessionId: "session-from-cleanup",
          role: "spec",
          scenario: null,
        });
      });

      await harness.unmount();

      const stored = memoryStorage.getItem(toContextStorageKey("/repo"));
      if (!stored) {
        throw new Error("Expected persisted context payload after unmount cleanup");
      }

      expect(JSON.parse(stored)).toEqual({
        taskId: "task-from-cleanup",
        role: "spec",
        sessionId: "session-from-cleanup",
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
        activeRepo: "/repo",
      });

      await harness.mount();
      await harness.run((latest) => {
        latest.setNavigation({
          taskId: "task-without-role",
          sessionId: "session-without-role",
          role: null,
          scenario: null,
        });
      });

      await harness.unmount();

      const stored = memoryStorage.getItem(toContextStorageKey("/repo"));
      if (!stored) {
        throw new Error("Expected persisted context payload");
      }

      expect(JSON.parse(stored)).toEqual({
        taskId: "task-without-role",
        sessionId: "session-without-role",
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
      memoryStorage.setItem(toContextStorageKey("/repo"), "{not-json");

      const harness = createHookHarness({
        activeRepo: "/repo",
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
        sessionId: null,
        role: null,
        scenario: null,
      });

      memoryStorage.setItem(
        toContextStorageKey("/repo"),
        JSON.stringify({
          taskId: "task-from-context",
          role: "planner",
          sessionId: "session-from-context",
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
        activeRepo: "/repo",
      });

      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.persistenceError?.message ===
          `Failed to read agent studio context storage key "${toContextStorageKey("/repo")}": read blocked`,
      );

      expect(harness.getLatest().persistenceError?.message).toBe(
        `Failed to read agent studio context storage key "${toContextStorageKey("/repo")}": read blocked`,
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
      memoryStorage.setItem(toContextStorageKey("/repo-a"), "{not-json");
      memoryStorage.setItem(
        toContextStorageKey("/repo-b"),
        JSON.stringify({
          taskId: "task-from-repo-b",
          role: "planner",
          sessionId: "session-from-repo-b",
        }),
      );

      const harness = createHookHarness({
        activeRepo: "/repo-a",
      });

      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.persistenceError?.message.includes(
            "Failed to parse persisted agent studio context",
          ) === true,
      );

      await harness.update({
        activeRepo: "/repo-b",
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
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });

    try {
      storage.setItem(
        toContextStorageKey("/repo-b"),
        JSON.stringify({
          taskId: "task-b",
          role: "planner",
          sessionId: "session-b",
        }),
      );

      const harness = createHookHarness({
        activeRepo: "/repo-a",
        initialNavigation: {
          taskId: "task-a",
          sessionId: "session-a",
          role: "build",
          scenario: "build_implementation_start",
        },
      });

      await harness.mount();

      await harness.update({
        activeRepo: "/repo-b",
      });

      await harness.waitFor((state) => state.navigation.taskId === "task-b");

      expect(harness.getLatest().isRepoNavigationBoundaryPending).toBeFalse();
      expect(harness.getLatest().navigation).toEqual({
        taskId: "task-b",
        sessionId: "session-b",
        role: "planner",
        scenario: null,
      });

      const repoBWrites = writes.filter((entry) => entry.key === toContextStorageKey("/repo-b"));
      expect(repoBWrites.some((entry) => entry.value.includes("task-a"))).toBeFalse();
      expect(repoBWrites.some((entry) => entry.value.includes("session-a"))).toBeFalse();

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
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

    try {
      const harness = createHookHarness({
        activeRepo: "/repo",
      });

      await harness.mount();
      const initialFlush = scheduledCallbacks.get(1);
      if (!initialFlush) {
        throw new Error("Expected initial persistence callback to be scheduled");
      }
      initialFlush();
      scheduledCallbacks.delete(1);

      await harness.run((latest) => {
        latest.setNavigation({
          taskId: "task-from-cleanup",
          sessionId: "session-from-cleanup",
          role: "spec",
          scenario: null,
        });
      });

      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: createThrowingStorage({
          throwOnSetItem: true,
          message: "write blocked",
        }),
      });

      const pendingFlush = scheduledCallbacks.get(2);
      if (!pendingFlush) {
        throw new Error("Expected pending persistence callback to be scheduled");
      }

      await harness.run(() => {
        pendingFlush();
      });
      scheduledCallbacks.delete(2);

      await harness.waitFor(
        (state) =>
          state.persistenceError?.message ===
          `Failed to persist agent studio context storage key "${toContextStorageKey("/repo")}": write blocked`,
      );

      expect(harness.getLatest().persistenceError?.message).toBe(
        `Failed to persist agent studio context storage key "${toContextStorageKey("/repo")}": write blocked`,
      );

      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: memoryStorage,
      });

      await harness.run((latest) => {
        latest.retryPersistenceRestore();
      });

      const retryFlush = scheduledCallbacks.get(3);
      if (!retryFlush) {
        throw new Error("Expected retry persistence callback to be scheduled");
      }

      await harness.run(() => {
        retryFlush();
      });
      scheduledCallbacks.delete(3);

      const stored = memoryStorage.getItem(toContextStorageKey("/repo"));
      if (!stored) {
        throw new Error("Expected persisted context payload after retry");
      }

      expect(JSON.parse(stored)).toEqual({
        taskId: "task-from-cleanup",
        role: "spec",
        sessionId: "session-from-cleanup",
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
