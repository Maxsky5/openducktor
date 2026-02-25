import { describe, expect, test } from "bun:test";
import type { SetURLSearchParams } from "react-router-dom";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { toContextStorageKey } from "./agents-page-utils";
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
      searchParams: new URLSearchParams(
        "task=task-1&agent=build&scenario=build_implementation_start&autostart=1&start=fresh",
      ),
      setSearchParams,
    });

    await harness.mount();
    const state = harness.getLatest();
    expect(state.taskIdParam).toBe("task-1");
    expect(state.roleFromQuery).toBe("build");
    expect(state.scenarioFromQuery).toBe("build_implementation_start");
    expect(state.autostart).toBe(true);
    expect(state.sessionStartPreference).toBe("fresh");

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
    expect(next.get("scenario")).toBe("build_implementation_start");
    expect(next.get("autostart")).toBe("1");
    expect(next.get("start")).toBe("fresh");
    expect(options).toEqual({ replace: true });

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
      expect(latest.scenarioFromQuery).toBe("planner_initial");

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
});
