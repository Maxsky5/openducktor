import { describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { host } from "./host";
import { useWorkspaceOperations } from "./use-workspace-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createDeferred = <T,>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T | "timeout"> => {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);
};

type HookArgs = Parameters<typeof useWorkspaceOperations>[0];

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: ReturnType<typeof useWorkspaceOperations> | null = null;
  let currentArgs = initialArgs;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useWorkspaceOperations(args);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  return {
    mount: async () => {
      await act(async () => {
        renderer = TestRenderer.create(createElement(Harness, { args: currentArgs }));
      });
      await flush();
    },
    updateArgs: async (nextArgs: HookArgs) => {
      currentArgs = nextArgs;
      await act(async () => {
        renderer?.update(createElement(Harness, { args: currentArgs }));
      });
      await flush();
    },
    run: async (fn: (value: ReturnType<typeof useWorkspaceOperations>) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await act(async () => {
        await fn(latest as ReturnType<typeof useWorkspaceOperations>);
      });
      await flush();
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    unmount: async () => {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    },
  };
};

const workspace = (path: string, isActive = false): WorkspaceRecord => ({
  path,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
});

describe("use-workspace-operations", () => {
  test("refreshWorkspaces updates list and active repo", async () => {
    const setActiveRepo = mock(() => {});
    const workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-a"), workspace("/repo-b", true)],
    );

    const original = { workspaceList: host.workspaceList };
    host.workspaceList = workspaceList;

    const harness = createHookHarness({
      activeRepo: null,
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshWorkspaces();
      });

      expect(harness.getLatest().workspaces).toHaveLength(2);
      expect(setActiveRepo).toHaveBeenCalledWith("/repo-b");
    } finally {
      await harness.unmount();
      host.workspaceList = original.workspaceList;
    }
  });

  test("addWorkspace trims path then refreshes", async () => {
    const setActiveRepo = mock(() => {});
    const workspaceAdd = mock(async (): Promise<WorkspaceRecord> => workspace("/repo-new"));
    const workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-new", true)],
    );

    const original = {
      workspaceAdd: host.workspaceAdd,
      workspaceList: host.workspaceList,
    };
    host.workspaceAdd = workspaceAdd;
    host.workspaceList = workspaceList;

    const harness = createHookHarness({
      activeRepo: null,
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.addWorkspace("  /repo-new  ");
      });

      expect(workspaceAdd).toHaveBeenCalledWith("/repo-new");
      expect(workspaceList).toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.workspaceAdd = original.workspaceAdd;
      host.workspaceList = original.workspaceList;
    }
  });

  test("selectWorkspace clears state and triggers runtime ensure", async () => {
    const setActiveRepo = mock(() => {});
    const clearTaskData = mock(() => {});
    const clearActiveBeadsCheck = mock(() => {});
    const workspaceSelect = mock(async (): Promise<WorkspaceRecord> => workspace("/repo-a", true));
    const runtimeDeferred = createDeferred<{
      runtimeId: string;
      repoPath: string;
      taskId: string;
      role: "build";
      workingDirectory: string;
      port: number;
      startedAt: string;
    }>();
    const runtimeEnsure = mock(async () => runtimeDeferred.promise);
    const runtimeValue = {
      runtimeId: "runtime-1",
      repoPath: "/repo-a",
      taskId: "task-1",
      role: "build",
      workingDirectory: "/tmp/repo-a",
      port: 3030,
      startedAt: "2026-02-22T08:00:00.000Z",
    } as const;
    const workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-a", true)],
    );

    const original = {
      workspaceSelect: host.workspaceSelect,
      opencodeRepoRuntimeEnsure: host.opencodeRepoRuntimeEnsure,
      workspaceList: host.workspaceList,
    };
    host.workspaceSelect = workspaceSelect;
    host.opencodeRepoRuntimeEnsure = runtimeEnsure;
    host.workspaceList = workspaceList;

    const harness = createHookHarness({
      activeRepo: null,
      setActiveRepo,
      clearTaskData,
      clearActiveBeadsCheck,
    });

    try {
      await harness.mount();
      let selectPromise: Promise<void> | null = null;
      await harness.run((value) => {
        selectPromise = value.selectWorkspace("/repo-a");
      });

      if (!selectPromise) {
        throw new Error("selectWorkspace promise was not captured");
      }

      const selectResult = await withTimeout(selectPromise, 20);
      expect(selectResult).toBeUndefined();
      expect(workspaceList).toHaveBeenCalled();
      runtimeDeferred.resolve(runtimeValue);
      await selectPromise;

      expect(setActiveRepo).toHaveBeenCalledWith("/repo-a");
      expect(clearTaskData).toHaveBeenCalled();
      expect(clearActiveBeadsCheck).toHaveBeenCalled();
      expect(workspaceSelect).toHaveBeenCalledWith("/repo-a");
      expect(runtimeEnsure).toHaveBeenCalledWith("/repo-a");
    } finally {
      runtimeDeferred.resolve(runtimeValue);
      await harness.unmount();
      host.workspaceSelect = original.workspaceSelect;
      host.opencodeRepoRuntimeEnsure = original.opencodeRepoRuntimeEnsure;
      host.workspaceList = original.workspaceList;
    }
  });

  test("ignores stale refresh branch updates after active repo changes", async () => {
    const setActiveRepo = mock(() => {});
    const currentBranchDeferred = createDeferred<{ name: string | undefined; detached: boolean }>();
    const gitGetCurrentBranch = mock(async () => currentBranchDeferred.promise);
    const gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ]);

    const original = {
      gitGetCurrentBranch: host.gitGetCurrentBranch,
      gitGetBranches: host.gitGetBranches,
    };
    host.gitGetCurrentBranch = gitGetCurrentBranch;
    host.gitGetBranches = gitGetBranches;

    const baseArgs = {
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    };
    const harness = createHookHarness({
      activeRepo: "/repo-a",
      ...baseArgs,
    });

    try {
      await harness.mount();

      let refreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        refreshPromise = value.refreshBranches();
      });

      await harness.updateArgs({
        activeRepo: "/repo-b",
        ...baseArgs,
      });

      if (!refreshPromise) {
        throw new Error("refreshBranches promise was not captured");
      }

      currentBranchDeferred.resolve({
        name: "main",
        detached: false,
      });
      await refreshPromise;
      await flush();

      expect(gitGetCurrentBranch).toHaveBeenCalledWith("/repo-a");
      expect(gitGetBranches).toHaveBeenCalledWith("/repo-a");
      expect(harness.getLatest().activeBranch).toBeNull();
    } finally {
      currentBranchDeferred.resolve({ name: undefined, detached: false });
      await harness.unmount();
      host.gitGetCurrentBranch = original.gitGetCurrentBranch;
      host.gitGetBranches = original.gitGetBranches;
    }
  });
});
