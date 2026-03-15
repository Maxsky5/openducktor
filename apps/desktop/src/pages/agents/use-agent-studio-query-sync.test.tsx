import { describe, expect, test } from "bun:test";
import type { SetURLSearchParams } from "react-router-dom";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { toContextStorageKey } from "./agents-page-selection";
import { useAgentStudioQuerySync } from "./use-agent-studio-query-sync";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioQuerySync>[0];
type SearchParamsCall = Parameters<SetURLSearchParams>;

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

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioQuerySync, initialProps);

describe("useAgentStudioQuerySync", () => {
  test("parses initial search params and syncs updates through a root-owned URL effect", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      activeRepo: null,
      searchParams: new URLSearchParams("task=task-1&agent=build"),
      setSearchParams,
    });

    await harness.mount();
    const state = harness.getLatest();
    expect(state.taskIdParam).toBe("task-1");
    expect(state.roleFromQuery).toBe("build");

    await harness.run((latest) => {
      latest.updateQuery({ session: "session-1" });
    });

    const lastCall = calls[calls.length - 1];
    if (!lastCall) {
      throw new Error("Expected setSearchParams to be called");
    }
    const [next, options] = lastCall;
    if (!(next instanceof URLSearchParams)) {
      throw new Error("Expected URLSearchParams");
    }
    expect(next.get("task")).toBe("task-1");
    expect(next.get("session")).toBe("session-1");
    expect(next.get("agent")).toBe("build");

    expect(next.get("autostart")).toBeNull();
    expect(next.get("start")).toBeNull();
    expect(options).toEqual({ replace: true });

    await harness.unmount();
  });

  test("syncs navigation state when URL search params change externally", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      activeRepo: null,
      searchParams: new URLSearchParams("task=task-1&agent=spec"),
      setSearchParams,
    });

    await harness.mount();
    expect(harness.getLatest().taskIdParam).toBe("task-1");
    expect(harness.getLatest().roleFromQuery).toBe("spec");
    expect(calls).toHaveLength(0);

    await harness.update({
      activeRepo: null,
      searchParams: new URLSearchParams("task=task-2&session=session-2&agent=planner"),
      setSearchParams,
    });

    const latest = harness.getLatest();
    expect(latest.taskIdParam).toBe("task-2");
    expect(latest.sessionParam).toBe("session-2");
    expect(latest.roleFromQuery).toBe("planner");

    expect(calls).toHaveLength(0);

    await harness.unmount();
  });

  test("restores persisted repo context when no explicit task context exists", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    try {
      memoryStorage.setItem(
        toContextStorageKey("/repo"),
        JSON.stringify({
          taskId: "task-from-context",
          role: "planner",
          scenario: "planner_initial",
          sessionId: "session-from-context",
        }),
      );

      const harness = createHookHarness({
        activeRepo: "/repo",
        searchParams: new URLSearchParams(""),
        setSearchParams,
      });

      await harness.mount();
      await harness.waitFor((state) => state.taskIdParam === "task-from-context");

      const latest = harness.getLatest();
      expect(latest.taskIdParam).toBe("task-from-context");
      expect(latest.sessionParam).toBe("session-from-context");
      expect(latest.roleFromQuery).toBe("planner");

      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("surfaces retryable persistence error for malformed repo context", async () => {
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
        searchParams: new URLSearchParams(""),
        setSearchParams: () => {},
      });

      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.navigationPersistenceError?.message.includes(
            "Failed to parse persisted agent studio context",
          ) === true,
      );

      expect(harness.getLatest().taskIdParam).toBe("");

      memoryStorage.setItem(
        toContextStorageKey("/repo"),
        JSON.stringify({
          taskId: "task-from-context",
          role: "planner",
          sessionId: "session-from-context",
        }),
      );

      await harness.run((latest) => {
        latest.retryNavigationPersistence();
      });
      await harness.waitFor((state) => state.taskIdParam === "task-from-context");

      expect(harness.getLatest().navigationPersistenceError).toBeNull();
      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("does not override explicit task/session from URL with persisted context", async () => {
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
          role: "build",
          scenario: "build_implementation_start",
          sessionId: "session-from-context",
        }),
      );

      const harness = createHookHarness({
        activeRepo: "/repo",
        searchParams: new URLSearchParams("task=task-from-url&session=session-from-url&agent=spec"),
        setSearchParams: () => {},
      });

      await harness.mount();
      const latest = harness.getLatest();
      expect(latest.taskIdParam).toBe("task-from-url");
      expect(latest.sessionParam).toBe("session-from-url");
      expect(latest.roleFromQuery).toBe("spec");
      expect(latest.hasExplicitRoleParam).toBe(true);
      await harness.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  test("flushes pending context persistence on unmount cleanup", async () => {
    const memoryStorage = createMemoryStorage();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });

    try {
      const harness = createHookHarness({
        activeRepo: "/repo",
        searchParams: new URLSearchParams("agent=spec"),
        setSearchParams: () => {},
      });

      await harness.mount();
      await harness.run((state) => {
        state.updateQuery({ task: "task-from-cleanup", session: "session-from-cleanup" });
      });

      await harness.unmount();

      const stored = memoryStorage.getItem(toContextStorageKey("/repo"));
      if (!stored) {
        throw new Error("Expected persisted context payload after unmount cleanup");
      }

      const parsed = JSON.parse(stored) as {
        taskId?: string;
        sessionId?: string;
        role?: string;
      };

      expect(parsed.taskId).toBe("task-from-cleanup");
      expect(parsed.sessionId).toBe("session-from-cleanup");
      expect(parsed.role).toBe("spec");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });
});
