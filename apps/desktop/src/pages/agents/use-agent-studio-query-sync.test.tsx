import { describe, expect, test } from "bun:test";
import { useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  createMemoryStorage,
  seedWorkspaceNavigationContexts,
  withMockedLocalStorage,
} from "./agent-studio-repo-persistence-test-utils";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { toContextStorageKey } from "./agents-page-selection";
import { useAgentStudioQuerySync } from "./use-agent-studio-query-sync";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioQuerySync>[0];
type SearchParamsCall = Parameters<SetURLSearchParams>;

type LegacyHookArgs = {
  activeWorkspace?: ActiveWorkspace | null;
  workspaceRepoPath?: string | null;
  persistenceWorkspaceId?: string | null;
  navigationType: HookArgs["navigationType"];
  searchParams: HookArgs["searchParams"];
  setSearchParams: HookArgs["setSearchParams"];
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
  navigationType,
  searchParams,
  setSearchParams,
}: LegacyHookArgs): HookArgs => ({
  activeWorkspace:
    activeWorkspace ??
    (workspaceRepoPath
      ? createActiveWorkspace(workspaceRepoPath, persistenceWorkspaceId ?? undefined)
      : null),
  navigationType,
  searchParams,
  setSearchParams,
});

const createHookHarness = (initialProps: LegacyHookArgs) =>
  createSharedHookHarness(
    (props: LegacyHookArgs) => useAgentStudioQuerySync(normalizeHookArgs(props)),
    initialProps,
  );

const createStatefulQuerySyncHarness = (
  initialProps: Pick<
    LegacyHookArgs,
    "activeWorkspace" | "workspaceRepoPath" | "persistenceWorkspaceId"
  > & {
    initialSearchParams: string;
  },
) =>
  createSharedHookHarness(
    ({
      activeWorkspace,
      workspaceRepoPath,
      persistenceWorkspaceId,
      initialSearchParams,
    }: Pick<LegacyHookArgs, "activeWorkspace" | "workspaceRepoPath" | "persistenceWorkspaceId"> & {
      initialSearchParams: string;
    }) => {
      const [searchParams, setSearchParamsState] = useState(
        () => new URLSearchParams(initialSearchParams),
      );
      const setSearchParams: SetURLSearchParams = (nextInit) => {
        if (nextInit instanceof URLSearchParams) {
          setSearchParamsState(new URLSearchParams(nextInit));
          return;
        }

        throw new Error("Expected URLSearchParams update in test harness");
      };

      return useAgentStudioQuerySync(
        normalizeHookArgs({
          ...(activeWorkspace === undefined ? {} : { activeWorkspace }),
          ...(workspaceRepoPath === undefined ? {} : { workspaceRepoPath }),
          ...(persistenceWorkspaceId === undefined ? {} : { persistenceWorkspaceId }),
          navigationType: "REPLACE",
          searchParams,
          setSearchParams,
        }),
      );
    },
    initialProps,
  );

const withActiveWorkspace = (
  overrides: Partial<LegacyHookArgs> & Pick<LegacyHookArgs, "activeWorkspace">,
): LegacyHookArgs => ({
  navigationType: "REPLACE",
  searchParams: new URLSearchParams(""),
  setSearchParams: () => {},
  ...overrides,
});

const withPersistenceWorkspaceId = (
  overrides: Partial<LegacyHookArgs> & Pick<LegacyHookArgs, "workspaceRepoPath">,
): LegacyHookArgs =>
  withActiveWorkspace({
    activeWorkspace: null,
    persistenceWorkspaceId: overrides.workspaceRepoPath ? "workspace-repo" : null,
    ...overrides,
  });

describe("useAgentStudioQuerySync", () => {
  test("parses initial search params and syncs updates through a root-owned URL effect", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      workspaceRepoPath: null,
      persistenceWorkspaceId: null,
      navigationType: "REPLACE",
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
      workspaceRepoPath: null,
      persistenceWorkspaceId: null,
      navigationType: "REPLACE",
      searchParams: new URLSearchParams("task=task-1&agent=spec"),
      setSearchParams,
    });

    await harness.mount();
    expect(harness.getLatest().taskIdParam).toBe("task-1");
    expect(harness.getLatest().roleFromQuery).toBe("spec");
    expect(calls).toHaveLength(0);

    await harness.update({
      workspaceRepoPath: null,
      persistenceWorkspaceId: null,
      navigationType: "POP",
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
        toContextStorageKey("workspace-repo"),
        JSON.stringify({
          taskId: "task-from-context",
          role: "planner",
          scenario: "planner_initial",
          sessionId: "session-from-context",
        }),
      );

      const harness = createHookHarness(
        withPersistenceWorkspaceId({
          workspaceRepoPath: "/repo",
          navigationType: "REPLACE",
          searchParams: new URLSearchParams(""),
          setSearchParams,
        }),
      );

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
      memoryStorage.setItem(toContextStorageKey("workspace-repo"), "{not-json");

      const harness = createHookHarness(
        withPersistenceWorkspaceId({
          workspaceRepoPath: "/repo",
          navigationType: "REPLACE",
          searchParams: new URLSearchParams(""),
          setSearchParams: () => {},
        }),
      );

      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.navigationPersistenceError?.message.includes(
            "Failed to parse persisted agent studio context",
          ) === true,
      );

      expect(harness.getLatest().taskIdParam).toBe("");

      memoryStorage.setItem(
        toContextStorageKey("workspace-repo"),
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

      const harness = createHookHarness(
        withPersistenceWorkspaceId({
          workspaceRepoPath: "/repo",
          navigationType: "REPLACE",
          searchParams: new URLSearchParams(
            "task=task-from-url&session=session-from-url&agent=spec",
          ),
          setSearchParams: () => {},
        }),
      );

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

  test("clears stale URL authority on repo switch before restoring the next repo context", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      memoryStorage.setItem(
        toContextStorageKey("workspace-repo-b"),
        JSON.stringify({
          taskId: "task-from-repo-b",
          role: "planner",
          sessionId: "session-from-repo-b",
        }),
      );

      const harness = createStatefulQuerySyncHarness({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
        initialSearchParams: "task=task-from-repo-a&session=session-from-repo-a&agent=build",
      });

      await harness.mount();

      await harness.update({
        workspaceRepoPath: "/repo-b",
        persistenceWorkspaceId: "workspace-repo-b",
        initialSearchParams: "task=task-from-repo-a&session=session-from-repo-a&agent=build",
      });

      await harness.waitFor((state) => state.taskIdParam === "task-from-repo-b");

      const latest = harness.getLatest();
      expect(latest.isRepoNavigationBoundaryPending).toBeFalse();
      expect(latest.taskIdParam).toBe("task-from-repo-b");
      expect(latest.sessionParam).toBe("session-from-repo-b");
      expect(latest.roleFromQuery).toBe("planner");

      await harness.unmount();
    });
  });

  test("restores repo-scoped URL context when switching back to a previous repository", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      seedWorkspaceNavigationContexts(memoryStorage, {
        "workspace-repo-a": { taskId: "task-a", role: "spec", sessionId: "session-a" },
        "workspace-repo-b": { taskId: "task-b", role: "planner", sessionId: "session-b" },
      });

      const harness = createStatefulQuerySyncHarness({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
        initialSearchParams: "",
      });

      await harness.mount();
      await harness.waitFor((state) => state.taskIdParam === "task-a");

      await harness.update({
        workspaceRepoPath: "/repo-b",
        persistenceWorkspaceId: "workspace-repo-b",
        initialSearchParams: "",
      });
      await harness.waitFor((state) => state.taskIdParam === "task-b");

      await harness.update({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
        initialSearchParams: "",
      });
      await harness.waitFor((state) => state.taskIdParam === "task-a");

      const latest = harness.getLatest();
      expect(latest.taskIdParam).toBe("task-a");
      expect(latest.sessionParam).toBe("session-a");
      expect(latest.roleFromQuery).toBe("spec");

      await harness.unmount();
    });
  });

  test("rapid repo changes keep the final repository context authoritative", async () => {
    const memoryStorage = createMemoryStorage();
    await withMockedLocalStorage(memoryStorage, async () => {
      seedWorkspaceNavigationContexts(memoryStorage, {
        "workspace-repo-a": { taskId: "task-a", role: "spec", sessionId: "session-a" },
        "workspace-repo-b": { taskId: "task-b", role: "planner", sessionId: "session-b" },
      });

      const harness = createStatefulQuerySyncHarness({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
        initialSearchParams: "",
      });

      await harness.mount();
      await harness.waitFor((state) => state.taskIdParam === "task-a");

      await harness.update({
        workspaceRepoPath: "/repo-b",
        persistenceWorkspaceId: "workspace-repo-b",
        initialSearchParams: "",
      });
      await harness.update({
        workspaceRepoPath: "/repo-a",
        persistenceWorkspaceId: "workspace-repo-a",
        initialSearchParams: "",
      });
      await harness.waitFor((state) => state.taskIdParam === "task-a");

      const latest = harness.getLatest();
      expect(latest.taskIdParam).toBe("task-a");
      expect(latest.sessionParam).toBe("session-a");
      expect(latest.roleFromQuery).toBe("spec");

      await harness.unmount();
    });
  });

  test("flushes pending context persistence on unmount cleanup", async () => {
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
          navigationType: "REPLACE",
          searchParams: new URLSearchParams("agent=spec"),
          setSearchParams: () => {},
        }),
      );

      await harness.mount();
      await harness.run((state) => {
        state.updateQuery({ task: "task-from-cleanup", session: "session-from-cleanup" });
      });

      await harness.unmount();

      const stored = memoryStorage.getItem(toContextStorageKey("workspace-repo"));
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
