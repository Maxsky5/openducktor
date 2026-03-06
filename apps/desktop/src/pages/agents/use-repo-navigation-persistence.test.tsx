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

const useHookHarness = ({ activeRepo, initialNavigation }: HookArgs) => {
  const [navigation, setNavigation] = useState<AgentStudioNavigationState>(
    initialNavigation ?? {
      taskId: "",
      sessionId: null,
      role: null,
    },
  );

  useRepoNavigationPersistence({
    activeRepo,
    navigation,
    setNavigation,
  });

  return {
    navigation,
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
});
