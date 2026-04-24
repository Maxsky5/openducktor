import { describe, expect, test } from "bun:test";
import { useState } from "react";
import type { ActiveWorkspace } from "@/types/state-slices";
import { type AgentStudioNavigationState, toContextStorageKey } from "./agent-studio-navigation";
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
  resolveRepoNavigationBoundaryPhase,
  useRepoNavigationPersistence,
} from "./use-repo-navigation-persistence";

enableReactActEnvironment();

type HookArgs = {
  activeWorkspace: ActiveWorkspace | null;
  initialNavigation?: AgentStudioNavigationState;
};

type LegacyHookArgs = {
  activeWorkspace?: ActiveWorkspace | null;
  workspaceRepoPath?: string | null;
  persistenceWorkspaceId?: string | null;
  initialNavigation?: AgentStudioNavigationState;
};

const createActiveWorkspace = (
  repoPath: string,
  workspaceId = repoPath.replace(/^\//, "").replaceAll("/", "-"),
): ActiveWorkspace => ({
  workspaceId,
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const normalizeHookArgs = ({
  activeWorkspace,
  workspaceRepoPath,
  persistenceWorkspaceId,
  initialNavigation,
}: LegacyHookArgs): HookArgs => ({
  ...(initialNavigation === undefined ? {} : { initialNavigation }),
  activeWorkspace:
    activeWorkspace ??
    (workspaceRepoPath
      ? createActiveWorkspace(workspaceRepoPath, persistenceWorkspaceId ?? undefined)
      : null),
});

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

const useHookHarness = (args: LegacyHookArgs) => {
  const { activeWorkspace, initialNavigation } = normalizeHookArgs(args);
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
      activeWorkspace,
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

const createHookHarness = (initialProps: LegacyHookArgs) =>
  createSharedHookHarness(useHookHarness, initialProps);

const withPersistenceWorkspaceId = (
  overrides: Partial<LegacyHookArgs> & Pick<LegacyHookArgs, "workspaceRepoPath">,
): LegacyHookArgs => ({
  persistenceWorkspaceId: overrides.workspaceRepoPath ? "workspace-repo" : null,
  ...overrides,
});

describe("useRepoNavigationPersistence", () => {
  test("treats the first render after a repo change as boundary-pending before effects run", () => {
    expect(
      resolveRepoNavigationBoundaryPhase({
        activeWorkspace: createActiveWorkspace("/repo-b"),
        lastWorkspaceId: "repo-a",
        boundaryWorkspaceId: null,
      }),
    ).toBe("detecting");
    expect(
      resolveRepoNavigationBoundaryPhase({
        activeWorkspace: createActiveWorkspace("/repo-a"),
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
          sessionId: "session-from-context",
        }),
      );

      const harness = createHookHarness(
        withPersistenceWorkspaceId({
          workspaceRepoPath: "/repo",
        }),
      );

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

  test("does not override explicit role-only selection with persisted repo context", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      seedWorkspaceNavigationContexts(memoryStorage, {
        "workspace-repo": {
          taskId: "task-from-context",
          role: "qa",
          sessionId: "session-from-context",
          scenario: "qa_review",
        },
      });

      const harness = createHookHarness(
        withPersistenceWorkspaceId({
          workspaceRepoPath: "/repo",
          initialNavigation: {
            taskId: "",
            sessionId: null,
            role: "planner",
            scenario: "planner_initial",
          },
        }),
      );

      await harness.mount();

      expect(harness.getLatest().navigation).toEqual({
        taskId: "",
        sessionId: null,
        role: "planner",
        scenario: "planner_initial",
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
      const harness = createHookHarness(
        withPersistenceWorkspaceId({
          workspaceRepoPath: "/repo",
        }),
      );

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

      const stored = memoryStorage.getItem(toContextStorageKey("workspace-repo"));
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
      const harness = createHookHarness(
        withPersistenceWorkspaceId({
          workspaceRepoPath: "/repo",
        }),
      );

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

      const stored = memoryStorage.getItem(toContextStorageKey("workspace-repo"));
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
      memoryStorage.setItem(toContextStorageKey("workspace-repo"), "{not-json");

      const harness = createHookHarness(
        withPersistenceWorkspaceId({
          workspaceRepoPath: "/repo",
        }),
      );

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
        toContextStorageKey("workspace-repo"),
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
      const harness = createHookHarness(
        withPersistenceWorkspaceId({
          workspaceRepoPath: "/repo",
        }),
      );

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
          sessionId: "session-from-repo-b",
        }),
      );

      const harness = createHookHarness({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
      });

      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.persistenceError?.message.includes(
            "Failed to parse persisted agent studio context",
          ) === true,
      );

      await harness.update({
        workspaceRepoPath: "/repo-b",
        persistenceWorkspaceId: "workspace-repo-b",
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
          sessionId: "session-b",
        }),
      );

      const harness = createHookHarness({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
        initialNavigation: {
          taskId: "task-a",
          sessionId: "session-a",
          role: "build",
          scenario: "build_implementation_start",
        },
      });

      await harness.mount();

      await harness.update({
        workspaceRepoPath: "/repo-b",
        persistenceWorkspaceId: "workspace-repo-b",
      });

      await harness.waitFor((state) => state.navigation.taskId === "task-b");

      expect(harness.getLatest().isRepoNavigationBoundaryPending).toBeFalse();
      expect(harness.getLatest().navigation).toEqual({
        taskId: "task-b",
        sessionId: "session-b",
        role: "planner",
        scenario: null,
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
        "workspace-repo-a": { taskId: "task-a", role: "spec", sessionId: "session-a" },
        "workspace-repo-b": { taskId: "task-b", role: "planner", sessionId: "session-b" },
      });

      const harness = createHookHarness({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
      });

      await harness.mount();
      await harness.waitFor((state) => state.navigation.taskId === "task-a");

      await harness.update({
        workspaceRepoPath: "/repo-b",
        persistenceWorkspaceId: "workspace-repo-b",
      });
      await harness.waitFor((state) => state.navigation.taskId === "task-b");

      await harness.update({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
      });
      await harness.waitFor((state) => state.navigation.taskId === "task-a");

      expect(harness.getLatest().navigation).toEqual({
        taskId: "task-a",
        sessionId: "session-a",
        role: "spec",
        scenario: null,
      });

      await harness.unmount();
    });
  });

  test("rapid repo changes leave the final repository context restored", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      seedWorkspaceNavigationContexts(memoryStorage, {
        "workspace-repo-a": { taskId: "task-a", role: "spec", sessionId: "session-a" },
        "workspace-repo-b": { taskId: "task-b", role: "planner", sessionId: "session-b" },
      });

      const harness = createHookHarness({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
      });

      await harness.mount();
      await harness.waitFor((state) => state.navigation.taskId === "task-a");

      await harness.update({
        workspaceRepoPath: "/repo-b",
        persistenceWorkspaceId: "workspace-repo-b",
      });
      await harness.update({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
      });
      await harness.waitFor((state) => state.navigation.taskId === "task-a");

      expect(harness.getLatest().navigation).toEqual({
        taskId: "task-a",
        sessionId: "session-a",
        role: "spec",
        scenario: null,
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

    try {
      const harness = createHookHarness(
        withPersistenceWorkspaceId({
          workspaceRepoPath: "/repo",
        }),
      );

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

      const retryFlushEntry = [...scheduledCallbacks.entries()].at(-1);
      if (!retryFlushEntry) {
        throw new Error("Expected retry persistence callback to be scheduled");
      }

      const [retryFlushId, retryFlush] = retryFlushEntry;
      await harness.run(() => {
        retryFlush();
      });
      scheduledCallbacks.delete(retryFlushId);

      await harness.waitFor((state) => state.persistenceError === null);

      const stored = memoryStorage.getItem(toContextStorageKey("workspace-repo"));
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
