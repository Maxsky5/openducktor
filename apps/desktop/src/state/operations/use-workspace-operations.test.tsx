import { describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createElement, useEffect, useRef, useState } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { toast } from "sonner";
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

const setGlobalProperty = (key: "window" | "document", value: unknown): void => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  if (!descriptor || descriptor.configurable) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
    return;
  }

  if ("writable" in descriptor && descriptor.writable) {
    (globalThis as Record<string, unknown>)[key] = value;
    return;
  }

  throw new Error(`Cannot override global ${key}`);
};

const mockBrowserGlobals = (windowValue: Window, documentValue: Document): (() => void) => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

  setGlobalProperty("window", windowValue);
  setGlobalProperty("document", documentValue);

  return () => {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, "window", windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }

    if (documentDescriptor) {
      Object.defineProperty(globalThis, "document", documentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  };
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
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
});

describe("use-workspace-operations", () => {
  test("hydrates branches when startup activates the persisted repository", async () => {
    const setActiveRepo = mock(() => {});
    const gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    const gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
      {
        name: "feature/startup",
        isCurrent: false,
        isRemote: false,
      },
    ]);

    const originalGitGetCurrentBranch = host.gitGetCurrentBranch;
    const originalGitGetBranches = host.gitGetBranches;
    host.gitGetCurrentBranch = gitGetCurrentBranch;
    host.gitGetBranches = gitGetBranches;

    type LifecycleHarnessArgs = HookArgs;

    let latest: ReturnType<typeof useWorkspaceOperations> | null = null;
    let currentArgs: LifecycleHarnessArgs = {
      activeRepo: null,
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    };

    const StartupBranchLoader = ({
      activeRepo,
      value,
    }: {
      activeRepo: string | null;
      value: ReturnType<typeof useWorkspaceOperations>;
    }) => {
      useEffect(() => {
        if (!activeRepo) {
          return;
        }
        void value.refreshBranches();
      }, [activeRepo, value.refreshBranches]);

      return null;
    };

    const Harness = ({ args }: { args: LifecycleHarnessArgs }) => {
      latest = useWorkspaceOperations(args);
      return createElement(StartupBranchLoader, {
        activeRepo: args.activeRepo,
        value: latest,
      });
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;

    try {
      await act(async () => {
        renderer = TestRenderer.create(createElement(Harness, { args: currentArgs }));
      });
      await flush();

      currentArgs = {
        ...currentArgs,
        activeRepo: "/repo-a",
      };

      await act(async () => {
        renderer?.update(createElement(Harness, { args: currentArgs }));
      });
      await flush();

      if (!latest) {
        throw new Error("Hook not mounted");
      }

      const latestValue: ReturnType<typeof useWorkspaceOperations> = latest;

      expect(latestValue.activeBranch).toEqual({
        name: "main",
        detached: false,
      });
      expect(latestValue.branches).toEqual([
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
        },
        {
          name: "feature/startup",
          isCurrent: false,
          isRemote: false,
        },
      ]);
      expect(latestValue.isLoadingBranches).toBe(false);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      host.gitGetCurrentBranch = originalGitGetCurrentBranch;
      host.gitGetBranches = originalGitGetBranches;
    }
  });

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
      kind: "opencode";
      runtimeId: string;
      repoPath: string;
      taskId: null;
      role: "workspace";
      workingDirectory: string;
      runtimeRoute: {
        type: "local_http";
        endpoint: string;
      };
      startedAt: string;
      descriptor: typeof OPENCODE_RUNTIME_DESCRIPTOR;
    }>();
    const runtimeEnsure = mock(async () => runtimeDeferred.promise);
    const workspaceGetRepoConfig = mock(async () => ({
      defaultRuntimeKind: "opencode" as const,
      branchPrefix: "obp",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
      hooks: {
        preStart: [],
        postComplete: [],
      },
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    }));
    const runtimeValue = {
      kind: "opencode",
      runtimeId: "runtime-1",
      repoPath: "/repo-a",
      taskId: null,
      role: "workspace",
      workingDirectory: "/tmp/repo-a",
      runtimeRoute: {
        type: "local_http" as const,
        endpoint: "http://127.0.0.1:3030",
      },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    } as const;
    const workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-a", true)],
    );

    const original = {
      workspaceSelect: host.workspaceSelect,
      runtimeEnsure: host.runtimeEnsure,
      workspaceGetRepoConfig: host.workspaceGetRepoConfig,
      workspaceList: host.workspaceList,
    };
    host.workspaceSelect = workspaceSelect;
    host.runtimeEnsure = runtimeEnsure;
    host.workspaceGetRepoConfig = workspaceGetRepoConfig;
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
      await Promise.resolve();

      expect(setActiveRepo).toHaveBeenCalledWith("/repo-a");
      expect(clearTaskData).toHaveBeenCalled();
      expect(clearActiveBeadsCheck).toHaveBeenCalled();
      expect(workspaceSelect).toHaveBeenCalledWith("/repo-a");
      expect(runtimeEnsure).toHaveBeenCalledWith("opencode", "/repo-a");
    } finally {
      runtimeDeferred.resolve(runtimeValue);
      await harness.unmount();
      host.workspaceSelect = original.workspaceSelect;
      host.runtimeEnsure = original.runtimeEnsure;
      host.workspaceGetRepoConfig = original.workspaceGetRepoConfig;
      host.workspaceList = original.workspaceList;
    }
  });

  test("hydrates branches after switching between real repositories", async () => {
    const workspaceSelectDeferred = createDeferred<WorkspaceRecord>();
    const workspaceSelect = mock(
      async (): Promise<WorkspaceRecord> => workspaceSelectDeferred.promise,
    );
    const workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-a", true)],
    );
    const workspaceGetRepoConfig = mock(async () => ({
      defaultRuntimeKind: "opencode" as const,
      branchPrefix: "obp",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
      hooks: {
        preStart: [],
        postComplete: [],
      },
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    }));
    const runtimeEnsure = mock(async () => ({
      kind: "opencode",
      runtimeId: "runtime-1",
      repoPath: "/repo-a",
      taskId: null,
      role: "workspace" as const,
      workingDirectory: "/tmp/repo-a",
      runtimeRoute: {
        type: "local_http" as const,
        endpoint: "http://127.0.0.1:3030",
      },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    }));
    const gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    const gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
      {
        name: "feature/repo-switch",
        isCurrent: false,
        isRemote: false,
      },
    ]);

    const originalWorkspaceSelect = host.workspaceSelect;
    const originalWorkspaceList = host.workspaceList;
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    const originalRuntimeEnsure = host.runtimeEnsure;
    const originalGitGetCurrentBranch = host.gitGetCurrentBranch;
    const originalGitGetBranches = host.gitGetBranches;
    host.workspaceSelect = workspaceSelect;
    host.workspaceList = workspaceList;
    host.workspaceGetRepoConfig = workspaceGetRepoConfig;
    host.runtimeEnsure = runtimeEnsure;
    host.gitGetCurrentBranch = gitGetCurrentBranch;
    host.gitGetBranches = gitGetBranches;

    let latest: ReturnType<typeof useWorkspaceOperations> | null = null;
    let latestActiveRepo: string | null = null;

    const Harness = () => {
      const [activeRepo, setActiveRepo] = useState<string | null>("/repo-old");
      const value = useWorkspaceOperations({
        activeRepo,
        setActiveRepo,
        clearTaskData: () => {},
        clearActiveBeadsCheck: () => {},
      });
      const previousRepoRef = useRef(activeRepo);

      latest = value;
      latestActiveRepo = activeRepo;

      useEffect(() => {
        if (previousRepoRef.current === activeRepo) {
          return;
        }

        previousRepoRef.current = activeRepo;

        if (!activeRepo) {
          return;
        }

        void value.refreshBranches();
      }, [activeRepo, value.refreshBranches]);

      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;

    try {
      await act(async () => {
        renderer = TestRenderer.create(createElement(Harness));
      });
      await flush();

      if (!latest) {
        throw new Error("Hook not mounted");
      }

      const latestValueBeforeSelect: ReturnType<typeof useWorkspaceOperations> = latest;

      let selectPromise: Promise<void> | null = null;
      await act(async () => {
        selectPromise = latestValueBeforeSelect.selectWorkspace("/repo-a");
      });
      await flush();

      expect(latestActiveRepo === "/repo-old").toBe(true);
      expect(gitGetCurrentBranch).not.toHaveBeenCalled();
      expect(gitGetBranches).not.toHaveBeenCalled();

      if (!selectPromise) {
        throw new Error("selectWorkspace promise was not captured");
      }

      await act(async () => {
        workspaceSelectDeferred.resolve(workspace("/repo-a", true));
        await selectPromise;
      });
      await flush();

      const currentActiveRepo: string | null = latestActiveRepo;
      expect(currentActiveRepo === "/repo-a").toBe(true);
      expect(gitGetCurrentBranch).toHaveBeenCalledWith("/repo-a");
      expect(gitGetBranches).toHaveBeenCalledWith("/repo-a");
      expect(workspaceList).toHaveBeenCalled();
      expect(runtimeEnsure).toHaveBeenCalledWith("opencode", "/repo-a");

      if (!latest) {
        throw new Error("Hook not mounted");
      }

      const latestValue: ReturnType<typeof useWorkspaceOperations> = latest;

      expect(latestValue.activeBranch).toEqual({
        name: "main",
        detached: false,
      });
      expect(latestValue.branches).toEqual([
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
        },
        {
          name: "feature/repo-switch",
          isCurrent: false,
          isRemote: false,
        },
      ]);
    } finally {
      workspaceSelectDeferred.resolve(workspace("/repo-a", true));
      await act(async () => {
        renderer?.unmount();
      });
      host.workspaceSelect = originalWorkspaceSelect;
      host.workspaceList = originalWorkspaceList;
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
      host.runtimeEnsure = originalRuntimeEnsure;
      host.gitGetCurrentBranch = originalGitGetCurrentBranch;
      host.gitGetBranches = originalGitGetBranches;
    }
  });

  test("preserves current repo branch state when workspace selection fails", async () => {
    const setActiveRepo = mock(() => {});
    const clearTaskData = mock(() => {});
    const clearActiveBeadsCheck = mock(() => {});
    const workspaceSelect = mock(async (): Promise<WorkspaceRecord> => {
      throw new Error("workspace switch failed");
    });
    const gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    const gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
      {
        name: "feature/current-repo",
        isCurrent: false,
        isRemote: false,
      },
    ]);

    const originalWorkspaceSelect = host.workspaceSelect;
    const originalGitGetCurrentBranch = host.gitGetCurrentBranch;
    const originalGitGetBranches = host.gitGetBranches;
    host.workspaceSelect = workspaceSelect;
    host.gitGetCurrentBranch = gitGetCurrentBranch;
    host.gitGetBranches = gitGetBranches;

    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo-old",
      setActiveRepo,
      clearTaskData,
      clearActiveBeadsCheck,
    });

    try {
      await harness.mount();

      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      expect(harness.getLatest().activeBranch).toEqual({
        name: "main",
        detached: false,
      });

      let thrown: unknown = null;
      await harness.run(async (value) => {
        try {
          await value.selectWorkspace("/repo-a");
        } catch (error) {
          thrown = error;
        }
      });

      expect(thrown).toBeInstanceOf(Error);
      expect(workspaceSelect).toHaveBeenCalledWith("/repo-a");
      expect(setActiveRepo).not.toHaveBeenCalledWith("/repo-a");
      expect(clearTaskData).not.toHaveBeenCalled();
      expect(clearActiveBeadsCheck).not.toHaveBeenCalled();
      expect(harness.getLatest().activeBranch).toEqual({
        name: "main",
        detached: false,
      });
      expect(harness.getLatest().branches).toEqual([
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
        },
        {
          name: "feature/current-repo",
          isCurrent: false,
          isRemote: false,
        },
      ]);
      expect(toastError).toHaveBeenCalledWith("Failed to switch repository", {
        description: "workspace switch failed",
      });
    } finally {
      await harness.unmount();
      host.workspaceSelect = originalWorkspaceSelect;
      host.gitGetCurrentBranch = originalGitGetCurrentBranch;
      host.gitGetBranches = originalGitGetBranches;
      (toast as { error: typeof toast.error }).error = originalToastError;
    }
  });

  test("keeps switched repo active when workspace refresh fails after a successful switch", async () => {
    const workspaceSelect = mock(async (): Promise<WorkspaceRecord> => workspace("/repo-a", true));
    const workspaceList = mock(async (): Promise<WorkspaceRecord[]> => {
      throw new Error("workspace list failed");
    });
    const workspaceGetRepoConfig = mock(async () => ({
      defaultRuntimeKind: "opencode" as const,
      branchPrefix: "obp",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
      hooks: {
        preStart: [],
        postComplete: [],
      },
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    }));
    const runtimeEnsure = mock(async () => ({
      kind: "opencode",
      runtimeId: "runtime-1",
      repoPath: "/repo-a",
      taskId: null,
      role: "workspace" as const,
      workingDirectory: "/tmp/repo-a",
      runtimeRoute: {
        type: "local_http" as const,
        endpoint: "http://127.0.0.1:3030",
      },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    }));
    const gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    const gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
      {
        name: "feature/repo-switch",
        isCurrent: false,
        isRemote: false,
      },
    ]);

    const originalWorkspaceSelect = host.workspaceSelect;
    const originalWorkspaceList = host.workspaceList;
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    const originalRuntimeEnsure = host.runtimeEnsure;
    const originalGitGetCurrentBranch = host.gitGetCurrentBranch;
    const originalGitGetBranches = host.gitGetBranches;
    host.workspaceSelect = workspaceSelect;
    host.workspaceList = workspaceList;
    host.workspaceGetRepoConfig = workspaceGetRepoConfig;
    host.runtimeEnsure = runtimeEnsure;
    host.gitGetCurrentBranch = gitGetCurrentBranch;
    host.gitGetBranches = gitGetBranches;

    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    let latest: ReturnType<typeof useWorkspaceOperations> | null = null;
    let latestActiveRepo: string | null = null;

    const Harness = () => {
      const [activeRepo, setActiveRepo] = useState<string | null>("/repo-old");
      const value = useWorkspaceOperations({
        activeRepo,
        setActiveRepo,
        clearTaskData: () => {},
        clearActiveBeadsCheck: () => {},
      });
      const previousRepoRef = useRef(activeRepo);
      const hasSeededWorkspacesRef = useRef(false);

      latest = value;
      latestActiveRepo = activeRepo;

      useEffect(() => {
        if (hasSeededWorkspacesRef.current) {
          return;
        }

        hasSeededWorkspacesRef.current = true;
        value.applyWorkspaceRecords([workspace("/repo-old", true), workspace("/repo-a", false)]);
      }, [value]);

      useEffect(() => {
        if (previousRepoRef.current === activeRepo) {
          return;
        }

        previousRepoRef.current = activeRepo;

        if (!activeRepo) {
          return;
        }

        void value.refreshBranches();
      }, [activeRepo, value.refreshBranches]);

      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;

    try {
      await act(async () => {
        renderer = TestRenderer.create(createElement(Harness));
      });
      await flush();

      if (!latest) {
        throw new Error("Hook not mounted");
      }

      const latestValueBeforeSelect: ReturnType<typeof useWorkspaceOperations> = latest;
      await act(async () => {
        await latestValueBeforeSelect.selectWorkspace("/repo-a");
      });
      await flush();

      expect(latestActiveRepo === "/repo-a").toBe(true);
      expect(gitGetCurrentBranch).toHaveBeenCalledWith("/repo-a");
      expect(gitGetBranches).toHaveBeenCalledWith("/repo-a");
      expect(toastError).toHaveBeenCalledWith("Repository switched, but workspace refresh failed", {
        description: "workspace list failed",
      });

      if (!latest) {
        throw new Error("Hook not mounted");
      }

      const latestValue: ReturnType<typeof useWorkspaceOperations> = latest;
      expect(latestValue.activeBranch).toEqual({
        name: "main",
        detached: false,
      });
      expect(latestValue.branches).toEqual([
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
        },
        {
          name: "feature/repo-switch",
          isCurrent: false,
          isRemote: false,
        },
      ]);
      expect(latestValue.workspaces).toEqual([
        workspace("/repo-old", false),
        workspace("/repo-a", true),
      ]);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      host.workspaceSelect = originalWorkspaceSelect;
      host.workspaceList = originalWorkspaceList;
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
      host.runtimeEnsure = originalRuntimeEnsure;
      host.gitGetCurrentBranch = originalGitGetCurrentBranch;
      host.gitGetBranches = originalGitGetBranches;
      (toast as { error: typeof toast.error }).error = originalToastError;
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

  test("keeps branch probe interval/listeners mounted while branch loading and switching flags change", async () => {
    const setActiveRepo = mock(() => {});
    const addWindowEventListener = mock(() => {});
    const removeWindowEventListener = mock(() => {});
    const setIntervalMock = mock(() => 1);
    const clearIntervalMock = mock(() => {});
    const addDocumentEventListener = mock(() => {});
    const removeDocumentEventListener = mock(() => {});
    const fakeWindow = {
      addEventListener: addWindowEventListener,
      removeEventListener: removeWindowEventListener,
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock,
    } as unknown as Window;
    const fakeDocument = {
      addEventListener: addDocumentEventListener,
      removeEventListener: removeDocumentEventListener,
      visibilityState: "visible" as const,
    } as unknown as Document;
    const restoreBrowserGlobals = mockBrowserGlobals(fakeWindow, fakeDocument);

    const gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    const gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
      {
        name: "feature",
        isCurrent: false,
        isRemote: false,
      },
    ]);
    const gitSwitchBranch = mock(async (_repoPath: string, branchName: string) => ({
      name: branchName,
      detached: false,
    }));

    const original = {
      gitGetCurrentBranch: host.gitGetCurrentBranch,
      gitGetBranches: host.gitGetBranches,
      gitSwitchBranch: host.gitSwitchBranch,
    };

    host.gitGetCurrentBranch = gitGetCurrentBranch;
    host.gitGetBranches = gitGetBranches;
    host.gitSwitchBranch = gitSwitchBranch;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      expect(addWindowEventListener).toHaveBeenCalledTimes(1);
      expect(addDocumentEventListener).toHaveBeenCalledTimes(1);
      expect(setIntervalMock).toHaveBeenCalledTimes(1);

      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.run(async (value) => {
        await value.switchBranch("feature");
      });

      expect(addWindowEventListener).toHaveBeenCalledTimes(1);
      expect(addDocumentEventListener).toHaveBeenCalledTimes(1);
      expect(setIntervalMock).toHaveBeenCalledTimes(1);
      expect(removeWindowEventListener).not.toHaveBeenCalled();
      expect(removeDocumentEventListener).not.toHaveBeenCalled();
      expect(clearIntervalMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      expect(removeWindowEventListener).toHaveBeenCalledTimes(1);
      expect(removeDocumentEventListener).toHaveBeenCalledTimes(1);
      expect(clearIntervalMock).toHaveBeenCalledTimes(1);

      host.gitGetCurrentBranch = original.gitGetCurrentBranch;
      host.gitGetBranches = original.gitGetBranches;
      host.gitSwitchBranch = original.gitSwitchBranch;
      restoreBrowserGlobals();
    }
  });

  test("marks branch sync degraded and throttles repeated probe failure toasts", async () => {
    const setActiveRepo = mock(() => {});
    let intervalCallback: (() => void) | null = null;
    let probeFailureCount = 0;

    const addWindowEventListener = mock(() => {});
    const removeWindowEventListener = mock(() => {});
    const setIntervalMock = mock((callback: () => void) => {
      intervalCallback = callback;
      return 1;
    });
    const clearIntervalMock = mock(() => {});
    const addDocumentEventListener = mock(() => {});
    const removeDocumentEventListener = mock(() => {});
    const fakeWindow = {
      addEventListener: addWindowEventListener,
      removeEventListener: removeWindowEventListener,
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock,
    } as unknown as Window;
    const fakeDocument = {
      addEventListener: addDocumentEventListener,
      removeEventListener: removeDocumentEventListener,
      visibilityState: "visible" as const,
    } as unknown as Document;
    const restoreBrowserGlobals = mockBrowserGlobals(fakeWindow, fakeDocument);

    const gitGetCurrentBranch = mock(async () => {
      probeFailureCount += 1;
      throw new Error(`permission denied while reading branch (${probeFailureCount})`);
    });

    const original = {
      gitGetCurrentBranch: host.gitGetCurrentBranch,
    };
    host.gitGetCurrentBranch = gitGetCurrentBranch;

    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      const callback = intervalCallback as unknown as (() => void) | null;
      if (!callback) {
        throw new Error("Expected interval callback to be set");
      }

      await act(async () => {
        callback();
      });
      await flush();

      expect(harness.getLatest().branchSyncDegraded).toBe(true);
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith("Branch sync probe degraded", {
        description: "[current_branch_probe] permission denied while reading branch (1)",
      });

      await act(async () => {
        callback();
      });
      await flush();

      expect(harness.getLatest().branchSyncDegraded).toBe(true);
      expect(toastError).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.gitGetCurrentBranch = original.gitGetCurrentBranch;
      (toast as { error: typeof toast.error }).error = originalToastError;
      restoreBrowserGlobals();
    }
  });

  test("ignores stale branch probe failures after active repository changes", async () => {
    const setActiveRepo = mock(() => {});
    let intervalCallback: (() => void) | null = null;
    const branchProbeDeferred = createDeferred<{ name: string | undefined; detached: boolean }>();

    const setIntervalMock = mock((callback: () => void) => {
      intervalCallback = callback;
      return 1;
    });
    const fakeWindow = {
      addEventListener: () => {},
      removeEventListener: () => {},
      setInterval: setIntervalMock,
      clearInterval: () => {},
    } as unknown as Window;
    const fakeDocument = {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: "visible" as const,
    } as unknown as Document;
    const restoreBrowserGlobals = mockBrowserGlobals(fakeWindow, fakeDocument);

    const gitGetCurrentBranch = mock(async () => branchProbeDeferred.promise);

    const original = {
      gitGetCurrentBranch: host.gitGetCurrentBranch,
    };
    host.gitGetCurrentBranch = gitGetCurrentBranch;

    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

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
      const callback = intervalCallback as unknown as (() => void) | null;
      if (!callback) {
        throw new Error("Expected interval callback to be set");
      }

      await act(async () => {
        callback();
      });
      await flush();

      await harness.updateArgs({
        activeRepo: "/repo-b",
        ...baseArgs,
      });

      branchProbeDeferred.reject(new Error("permission denied while reading branch"));
      await flush();

      expect(gitGetCurrentBranch).toHaveBeenCalledWith("/repo-a");
      expect(harness.getLatest().branchSyncDegraded).toBe(false);
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.gitGetCurrentBranch = original.gitGetCurrentBranch;
      (toast as { error: typeof toast.error }).error = originalToastError;
      restoreBrowserGlobals();
    }
  });

  test("clears degraded branch sync state after a successful probe", async () => {
    const setActiveRepo = mock(() => {});
    let shouldFailProbe = true;
    let intervalCallback: (() => void) | null = null;

    const setIntervalMock = mock((callback: () => void) => {
      intervalCallback = callback;
      return 1;
    });
    const fakeWindow = {
      addEventListener: () => {},
      removeEventListener: () => {},
      setInterval: setIntervalMock,
      clearInterval: () => {},
    } as unknown as Window;
    const fakeDocument = {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: "visible" as const,
    } as unknown as Document;
    const restoreBrowserGlobals = mockBrowserGlobals(fakeWindow, fakeDocument);

    const gitGetCurrentBranch = mock(async () => {
      if (shouldFailProbe) {
        throw new Error("git probe failed");
      }
      return {
        name: "main",
        detached: false,
      };
    });
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

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      const callback = intervalCallback as unknown as (() => void) | null;
      if (!callback) {
        throw new Error("Expected interval callback to be set");
      }

      await act(async () => {
        callback();
      });
      await flush();

      expect(harness.getLatest().branchSyncDegraded).toBe(true);

      shouldFailProbe = false;
      await act(async () => {
        callback();
      });
      await flush();

      expect(harness.getLatest().branchSyncDegraded).toBe(false);
    } finally {
      await harness.unmount();
      host.gitGetCurrentBranch = original.gitGetCurrentBranch;
      host.gitGetBranches = original.gitGetBranches;
      restoreBrowserGlobals();
    }
  });

  test("marks branch sync degraded when refresh after branch identity change fails", async () => {
    const setActiveRepo = mock(() => {});
    let intervalCallback: (() => void) | null = null;
    let currentBranchCallCount = 0;
    let branchesCallCount = 0;

    const setIntervalMock = mock((callback: () => void) => {
      intervalCallback = callback;
      return 1;
    });
    const fakeWindow = {
      addEventListener: () => {},
      removeEventListener: () => {},
      setInterval: setIntervalMock,
      clearInterval: () => {},
    } as unknown as Window;
    const fakeDocument = {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: "visible" as const,
    } as unknown as Document;
    const restoreBrowserGlobals = mockBrowserGlobals(fakeWindow, fakeDocument);

    const gitGetCurrentBranch = mock(async () => {
      currentBranchCallCount += 1;
      return {
        name: currentBranchCallCount === 1 ? "main" : "feature/probe",
        detached: false,
      };
    });
    const gitGetBranches = mock(async () => {
      branchesCallCount += 1;
      if (branchesCallCount === 1) {
        return [
          {
            name: "main",
            isCurrent: true,
            isRemote: false,
          },
          {
            name: "feature/probe",
            isCurrent: false,
            isRemote: false,
          },
        ];
      }

      throw new Error("git branches load failed");
    });

    const original = {
      gitGetCurrentBranch: host.gitGetCurrentBranch,
      gitGetBranches: host.gitGetBranches,
    };
    host.gitGetCurrentBranch = gitGetCurrentBranch;
    host.gitGetBranches = gitGetBranches;

    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      const callback = intervalCallback as unknown as (() => void) | null;
      if (!callback) {
        throw new Error("Expected interval callback to be set");
      }

      await act(async () => {
        callback();
      });
      await flush();

      expect(harness.getLatest().branchSyncDegraded).toBe(true);
      expect(toastError).toHaveBeenCalledWith("Branch sync probe degraded", {
        description: "[branch_refresh] git branches load failed",
      });
    } finally {
      await harness.unmount();
      host.gitGetCurrentBranch = original.gitGetCurrentBranch;
      host.gitGetBranches = original.gitGetBranches;
      (toast as { error: typeof toast.error }).error = originalToastError;
      restoreBrowserGlobals();
    }
  });

  test("clears branch cache and degraded state on active repository change", async () => {
    const setActiveRepo = mock(() => {});
    let intervalCallback: (() => void) | null = null;

    const setIntervalMock = mock((callback: () => void) => {
      intervalCallback = callback;
      return 1;
    });
    const fakeWindow = {
      addEventListener: () => {},
      removeEventListener: () => {},
      setInterval: setIntervalMock,
      clearInterval: () => {},
    } as unknown as Window;
    const fakeDocument = {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: "visible" as const,
    } as unknown as Document;
    const restoreBrowserGlobals = mockBrowserGlobals(fakeWindow, fakeDocument);

    const gitGetCurrentBranch = mock(async () => {
      throw new Error("permission denied while reading branch");
    });

    const original = {
      gitGetCurrentBranch: host.gitGetCurrentBranch,
    };
    host.gitGetCurrentBranch = gitGetCurrentBranch;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();

      const callback = intervalCallback as unknown as (() => void) | null;
      if (!callback) {
        throw new Error("Expected interval callback to be set");
      }

      await act(async () => {
        callback();
      });
      await flush();

      expect(harness.getLatest().branchSyncDegraded).toBe(true);

      await harness.updateArgs({
        activeRepo: "/repo-b",
        setActiveRepo,
        clearTaskData: () => {},
        clearActiveBeadsCheck: () => {},
      });

      expect(harness.getLatest().branchSyncDegraded).toBe(false);
      expect(harness.getLatest().activeBranch).toBeNull();
      expect(harness.getLatest().branches).toHaveLength(0);
    } finally {
      await harness.unmount();
      host.gitGetCurrentBranch = original.gitGetCurrentBranch;
      restoreBrowserGlobals();
    }
  });
});
