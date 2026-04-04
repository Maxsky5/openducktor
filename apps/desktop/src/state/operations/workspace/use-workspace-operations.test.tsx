import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot, WorkspaceRecord } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { act, createElement, type PropsWithChildren, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";
import { useWorkspaceOperations } from "./use-workspace-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type WorkspaceHostClient = NonNullable<Parameters<typeof useWorkspaceOperations>[0]["hostClient"]>;
type SettingsSnapshotHostClient = NonNullable<Parameters<typeof settingsSnapshotQueryOptions>[0]>;
type WorkspaceIntegrationHostClient = WorkspaceHostClient & SettingsSnapshotHostClient;

const createWorkspaceHostClient = (): WorkspaceIntegrationHostClient =>
  ({
    workspaceList: async () => [],
    workspaceAdd: async (repoPath: string) => workspace(repoPath),
    workspaceSelect: async (repoPath: string) => workspace(repoPath, true),
    workspaceGetRepoConfig: async () => {
      throw new Error("workspaceGetRepoConfig not configured");
    },
    workspaceGetSettingsSnapshot: async () => {
      throw new Error("workspaceGetSettingsSnapshot not configured");
    },
    runtimeEnsure: async () => {
      throw new Error("runtimeEnsure not configured");
    },
    gitGetCurrentBranch: async () => {
      throw new Error("gitGetCurrentBranch not configured");
    },
    gitGetBranches: async () => {
      throw new Error("gitGetBranches not configured");
    },
    gitGetWorktreeStatus: async () => {
      throw new Error("gitGetWorktreeStatus not configured");
    },
    gitGetWorktreeStatusSummary: async () => {
      throw new Error("gitGetWorktreeStatusSummary not configured");
    },
    gitSwitchBranch: async () => {
      throw new Error("gitSwitchBranch not configured");
    },
  }) as WorkspaceIntegrationHostClient;

let workspaceHost = createWorkspaceHostClient();

const IsolatedQueryWrapper = ({ children }: PropsWithChildren) => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createBrowserListenerHarness = (
  visibilityState: DocumentVisibilityState = "visible",
): {
  addWindowEventListener: ReturnType<typeof mock>;
  removeWindowEventListener: ReturnType<typeof mock>;
  addDocumentEventListener: ReturnType<typeof mock>;
  removeDocumentEventListener: ReturnType<typeof mock>;
  triggerFocus: () => Promise<void>;
  triggerVisibilityChange: (nextVisibilityState?: DocumentVisibilityState) => Promise<void>;
  restoreBrowserGlobals: () => void;
} => {
  let focusHandler: (() => void) | null = null;
  let visibilityChangeHandler: (() => void) | null = null;
  let currentVisibilityState = visibilityState;
  const originalWindowAddEventListener = window.addEventListener.bind(window);
  const originalWindowRemoveEventListener = window.removeEventListener.bind(window);
  const originalDocumentAddEventListener = document.addEventListener.bind(document);
  const originalDocumentRemoveEventListener = document.removeEventListener.bind(document);
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");

  const addWindowEventListener = mock(
    (event: string, handler: EventListenerOrEventListenerObject) => {
      if (event === "focus" && typeof handler === "function") {
        focusHandler = handler as () => void;
      }
    },
  );
  const removeWindowEventListener = mock(() => {});
  const addDocumentEventListener = mock(
    (event: string, handler: EventListenerOrEventListenerObject) => {
      if (event === "visibilitychange" && typeof handler === "function") {
        visibilityChangeHandler = handler as () => void;
      }
    },
  );
  const removeDocumentEventListener = mock(() => {});

  window.addEventListener = addWindowEventListener as typeof window.addEventListener;
  window.removeEventListener = removeWindowEventListener as typeof window.removeEventListener;
  document.addEventListener = addDocumentEventListener as typeof document.addEventListener;
  document.removeEventListener = removeDocumentEventListener as typeof document.removeEventListener;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get() {
      return currentVisibilityState;
    },
  });

  const restoreBrowserGlobals = () => {
    window.addEventListener = originalWindowAddEventListener;
    window.removeEventListener = originalWindowRemoveEventListener;
    document.addEventListener = originalDocumentAddEventListener;
    document.removeEventListener = originalDocumentRemoveEventListener;

    if (originalVisibilityState) {
      Object.defineProperty(document, "visibilityState", originalVisibilityState);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
  };

  return {
    addWindowEventListener,
    removeWindowEventListener,
    addDocumentEventListener,
    removeDocumentEventListener,
    triggerFocus: async () => {
      if (!focusHandler) {
        throw new Error("Expected focus handler to be registered");
      }
      await act(async () => {
        focusHandler?.();
      });
      await flush();
    },
    triggerVisibilityChange: async (nextVisibilityState = "visible") => {
      currentVisibilityState = nextVisibilityState;
      if (!visibilityChangeHandler) {
        throw new Error("Expected visibilitychange handler to be registered");
      }
      await act(async () => {
        visibilityChangeHandler?.();
      });
      await flush();
    },
    restoreBrowserGlobals,
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

beforeEach(async () => {
  workspaceHost = createWorkspaceHostClient();
});

type HookArgs = Parameters<typeof useWorkspaceOperations>[0];

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: ReturnType<typeof useWorkspaceOperations> | null = null;
  let currentArgs = initialArgs;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useWorkspaceOperations({
      ...args,
      hostClient: args.hostClient ?? workspaceHost,
    });
    return null;
  };

  const sharedHarness = createSharedHookHarness(
    Harness,
    { args: currentArgs },
    { wrapper: IsolatedQueryWrapper },
  );

  return {
    mount: async () => {
      await sharedHarness.mount();
    },
    updateArgs: async (nextArgs: HookArgs) => {
      currentArgs = nextArgs;
      await sharedHarness.update({ args: currentArgs });
    },
    run: async (fn: (value: ReturnType<typeof useWorkspaceOperations>) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await sharedHarness.run(async () => {
        await fn(latest as ReturnType<typeof useWorkspaceOperations>);
      });
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    unmount: async () => {
      await sharedHarness.unmount();
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

const settingsSnapshot = (repoPaths: string[]): SettingsSnapshot => ({
  theme: "light",
  git: {
    defaultMergeMethod: "merge_commit",
  },
  chat: {
    showThinkingMessages: false,
  },
  kanban: {
    doneVisibleDays: 1,
  },
  autopilot: {
    rules: [],
  },
  repos: Object.fromEntries(
    repoPaths.map((repoPath) => [
      repoPath,
      {
        defaultRuntimeKind: "opencode" as const,
        branchPrefix: "odt",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {
          providers: {},
        },
        trustedHooks: false,
        hooks: {
          preStart: [],
          postComplete: [],
        },
        devServers: [],
        worktreeFileCopies: [],
        promptOverrides: {},
        agentDefaults: {},
      },
    ]),
  ),
  globalPromptOverrides: {},
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

    const originalGitGetCurrentBranch = workspaceHost.gitGetCurrentBranch;
    const originalGitGetBranches = workspaceHost.gitGetBranches;
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;

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
      latest = useWorkspaceOperations({
        ...args,
        hostClient: workspaceHost,
      });
      return createElement(StartupBranchLoader, {
        activeRepo: args.activeRepo,
        value: latest,
      });
    };

    let rerender: (ui: Parameters<typeof render>[0]) => void = () => {};
    let unmount = () => {};

    try {
      await act(async () => {
        const rendered = render(createElement(Harness, { args: currentArgs }), {
          wrapper: IsolatedQueryWrapper,
        });
        rerender = rendered.rerender;
        unmount = rendered.unmount;
      });
      await flush();

      currentArgs = {
        ...currentArgs,
        activeRepo: "/repo-a",
      };

      await act(async () => {
        rerender(createElement(Harness, { args: currentArgs }));
      });
      await flush();
      await waitFor(() => {
        expect(latest?.activeBranch).toEqual({
          name: "main",
          detached: false,
        });
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
          name: "feature/startup",
          isCurrent: false,
          isRemote: false,
        },
      ]);
      expect(latestValue.isLoadingBranches).toBe(false);
    } finally {
      unmount();
      workspaceHost.gitGetCurrentBranch = originalGitGetCurrentBranch;
      workspaceHost.gitGetBranches = originalGitGetBranches;
    }
  });

  test("refreshWorkspaces updates list and active repo", async () => {
    const setActiveRepo = mock(() => {});
    const workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-a"), workspace("/repo-b", true)],
    );

    const original = { workspaceList: workspaceHost.workspaceList };
    workspaceHost.workspaceList = workspaceList;

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
      workspaceHost.workspaceList = original.workspaceList;
    }
  });

  test("addWorkspace trims path then refreshes", async () => {
    const setActiveRepo = mock(() => {});
    const workspaceAdd = mock(async (): Promise<WorkspaceRecord> => workspace("/repo-new"));
    const workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-new", true)],
    );
    const hostClient = createWorkspaceHostClient();
    hostClient.workspaceAdd = workspaceAdd;
    hostClient.workspaceList = workspaceList;

    const harness = createHookHarness({
      activeRepo: null,
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
      hostClient,
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
    }
  });

  test("addWorkspace clears cached settings snapshot for next read", async () => {
    const setActiveRepo = mock(() => {});
    const workspaceGetSettingsSnapshot = mock(async () => settingsSnapshot(["/repo-old"]));
    const hostClient = createWorkspaceHostClient();
    hostClient.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;
    hostClient.workspaceAdd = mock(
      async (): Promise<WorkspaceRecord> => workspace("/repo-new", true),
    );
    hostClient.workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-new", true)],
    );
    let latest: ReturnType<typeof useWorkspaceOperations> | null = null;

    const SettingsSnapshotProbe = () => {
      useQuery(settingsSnapshotQueryOptions(hostClient));
      return null;
    };

    const Harness = () => {
      latest = useWorkspaceOperations({
        activeRepo: null,
        setActiveRepo,
        clearTaskData: () => {},
        clearActiveBeadsCheck: () => {},
        hostClient,
      });
      return createElement(SettingsSnapshotProbe);
    };

    const rendered = render(createElement(Harness), {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryProvider useIsolatedClient>{children}</QueryProvider>
      ),
    });

    try {
      await waitFor(() => {
        expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
      });

      workspaceGetSettingsSnapshot.mockImplementationOnce(async () =>
        settingsSnapshot(["/repo-old", "/repo-new"]),
      );

      if (!latest) {
        throw new Error("Hook not mounted");
      }

      await act(async () => {
        await latest?.addWorkspace("/repo-new");
      });

      await waitFor(() => {
        expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(2);
      });
    } finally {
      rendered.unmount();
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
      devServers: [],
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
      workspaceSelect: workspaceHost.workspaceSelect,
      runtimeEnsure: workspaceHost.runtimeEnsure,
      workspaceGetRepoConfig: workspaceHost.workspaceGetRepoConfig,
      workspaceList: workspaceHost.workspaceList,
    };
    workspaceHost.workspaceSelect = workspaceSelect;
    workspaceHost.runtimeEnsure = runtimeEnsure;
    workspaceHost.workspaceGetRepoConfig = workspaceGetRepoConfig;
    workspaceHost.workspaceList = workspaceList;

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
      expect(runtimeEnsure).toHaveBeenCalledWith("/repo-a", "opencode");
    } finally {
      runtimeDeferred.resolve(runtimeValue);
      await harness.unmount();
      workspaceHost.workspaceSelect = original.workspaceSelect;
      workspaceHost.runtimeEnsure = original.runtimeEnsure;
      workspaceHost.workspaceGetRepoConfig = original.workspaceGetRepoConfig;
      workspaceHost.workspaceList = original.workspaceList;
    }
  });

  test("selectWorkspace clears cached settings snapshot for next read", async () => {
    const setActiveRepo = mock(() => {});
    const clearTaskData = mock(() => {});
    const clearActiveBeadsCheck = mock(() => {});
    const workspaceGetSettingsSnapshot = mock(async () => settingsSnapshot(["/repo-old"]));
    const hostClient = createWorkspaceHostClient();
    hostClient.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;
    hostClient.workspaceSelect = mock(
      async (): Promise<WorkspaceRecord> => workspace("/repo-a", true),
    );
    hostClient.workspaceList = mock(
      async (): Promise<WorkspaceRecord[]> => [workspace("/repo-a", true)],
    );
    hostClient.workspaceGetRepoConfig = mock(async () => ({
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
      devServers: [],
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    }));
    hostClient.runtimeEnsure = mock(async () => ({
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
    let latest: ReturnType<typeof useWorkspaceOperations> | null = null;

    const SettingsSnapshotProbe = () => {
      useQuery(settingsSnapshotQueryOptions(hostClient));
      return null;
    };

    const Harness = () => {
      latest = useWorkspaceOperations({
        activeRepo: null,
        setActiveRepo,
        clearTaskData,
        clearActiveBeadsCheck,
        hostClient,
      });
      return createElement(SettingsSnapshotProbe);
    };

    const rendered = render(createElement(Harness), {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryProvider useIsolatedClient>{children}</QueryProvider>
      ),
    });

    try {
      await waitFor(() => {
        expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
      });

      workspaceGetSettingsSnapshot.mockImplementationOnce(async () =>
        settingsSnapshot(["/repo-old", "/repo-a"]),
      );

      if (!latest) {
        throw new Error("Hook not mounted");
      }

      await act(async () => {
        await latest?.selectWorkspace("/repo-a");
      });

      await waitFor(() => {
        expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(2);
      });
    } finally {
      rendered.unmount();
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
      devServers: [],
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

    const originalWorkspaceSelect = workspaceHost.workspaceSelect;
    const originalWorkspaceList = workspaceHost.workspaceList;
    const originalWorkspaceGetRepoConfig = workspaceHost.workspaceGetRepoConfig;
    const originalRuntimeEnsure = workspaceHost.runtimeEnsure;
    const originalGitGetCurrentBranch = workspaceHost.gitGetCurrentBranch;
    const originalGitGetBranches = workspaceHost.gitGetBranches;
    workspaceHost.workspaceSelect = workspaceSelect;
    workspaceHost.workspaceList = workspaceList;
    workspaceHost.workspaceGetRepoConfig = workspaceGetRepoConfig;
    workspaceHost.runtimeEnsure = runtimeEnsure;
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;

    let latest: ReturnType<typeof useWorkspaceOperations> | null = null;
    let latestActiveRepo: string | null = null;

    const Harness = () => {
      const [activeRepo, setActiveRepo] = useState<string | null>("/repo-old");
      const value = useWorkspaceOperations({
        activeRepo,
        setActiveRepo,
        clearTaskData: () => {},
        clearActiveBeadsCheck: () => {},
        hostClient: workspaceHost,
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

    let unmount = () => {};

    try {
      await act(async () => {
        const rendered = render(createElement(Harness), {
          wrapper: IsolatedQueryWrapper,
        });
        unmount = rendered.unmount;
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
      expect(runtimeEnsure).toHaveBeenCalledWith("/repo-a", "opencode");

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
      unmount();
      workspaceHost.workspaceSelect = originalWorkspaceSelect;
      workspaceHost.workspaceList = originalWorkspaceList;
      workspaceHost.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
      workspaceHost.runtimeEnsure = originalRuntimeEnsure;
      workspaceHost.gitGetCurrentBranch = originalGitGetCurrentBranch;
      workspaceHost.gitGetBranches = originalGitGetBranches;
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

    const originalWorkspaceSelect = workspaceHost.workspaceSelect;
    const originalGitGetCurrentBranch = workspaceHost.gitGetCurrentBranch;
    const originalGitGetBranches = workspaceHost.gitGetBranches;
    workspaceHost.workspaceSelect = workspaceSelect;
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;

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
      workspaceHost.workspaceSelect = originalWorkspaceSelect;
      workspaceHost.gitGetCurrentBranch = originalGitGetCurrentBranch;
      workspaceHost.gitGetBranches = originalGitGetBranches;
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
      devServers: [],
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

    const originalWorkspaceSelect = workspaceHost.workspaceSelect;
    const originalWorkspaceList = workspaceHost.workspaceList;
    const originalWorkspaceGetRepoConfig = workspaceHost.workspaceGetRepoConfig;
    const originalRuntimeEnsure = workspaceHost.runtimeEnsure;
    const originalGitGetCurrentBranch = workspaceHost.gitGetCurrentBranch;
    const originalGitGetBranches = workspaceHost.gitGetBranches;
    workspaceHost.workspaceSelect = workspaceSelect;
    workspaceHost.workspaceList = workspaceList;
    workspaceHost.workspaceGetRepoConfig = workspaceGetRepoConfig;
    workspaceHost.runtimeEnsure = runtimeEnsure;
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;

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
        hostClient: workspaceHost,
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

    let unmount = () => {};

    try {
      await act(async () => {
        const rendered = render(createElement(Harness), {
          wrapper: IsolatedQueryWrapper,
        });
        unmount = rendered.unmount;
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
      unmount();
      workspaceHost.workspaceSelect = originalWorkspaceSelect;
      workspaceHost.workspaceList = originalWorkspaceList;
      workspaceHost.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
      workspaceHost.runtimeEnsure = originalRuntimeEnsure;
      workspaceHost.gitGetCurrentBranch = originalGitGetCurrentBranch;
      workspaceHost.gitGetBranches = originalGitGetBranches;
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
      gitGetCurrentBranch: workspaceHost.gitGetCurrentBranch,
      gitGetBranches: workspaceHost.gitGetBranches,
    };
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;

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
      workspaceHost.gitGetCurrentBranch = original.gitGetCurrentBranch;
      workspaceHost.gitGetBranches = original.gitGetBranches;
    }
  });

  test("keeps branch probe listeners mounted while branch loading and switching flags change", async () => {
    const setActiveRepo = mock(() => {});
    const {
      addWindowEventListener,
      removeWindowEventListener,
      addDocumentEventListener,
      removeDocumentEventListener,
      restoreBrowserGlobals,
    } = createBrowserListenerHarness();

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
      gitGetCurrentBranch: workspaceHost.gitGetCurrentBranch,
      gitGetBranches: workspaceHost.gitGetBranches,
      gitSwitchBranch: workspaceHost.gitSwitchBranch,
    };

    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;
    workspaceHost.gitSwitchBranch = gitSwitchBranch;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      expect(addWindowEventListener.mock.calls.filter(([event]) => event === "focus")).toHaveLength(
        1,
      );
      expect(
        addDocumentEventListener.mock.calls.filter(([event]) => event === "visibilitychange"),
      ).toHaveLength(1);

      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.run(async (value) => {
        await value.switchBranch("feature");
      });

      expect(addWindowEventListener.mock.calls.filter(([event]) => event === "focus")).toHaveLength(
        1,
      );
      expect(
        addDocumentEventListener.mock.calls.filter(([event]) => event === "visibilitychange"),
      ).toHaveLength(1);
      expect(removeWindowEventListener).not.toHaveBeenCalled();
      expect(removeDocumentEventListener).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      await waitFor(() => {
        expect(
          removeWindowEventListener.mock.calls.filter(([event]) => event === "focus"),
        ).toHaveLength(1);
        expect(
          removeDocumentEventListener.mock.calls.filter(([event]) => event === "visibilitychange"),
        ).toHaveLength(1);
      });

      workspaceHost.gitGetCurrentBranch = original.gitGetCurrentBranch;
      workspaceHost.gitGetBranches = original.gitGetBranches;
      workspaceHost.gitSwitchBranch = original.gitSwitchBranch;
      restoreBrowserGlobals();
    }
  });

  test("marks branch sync degraded and throttles repeated probe failure toasts", async () => {
    const setActiveRepo = mock(() => {});
    let probeFailureCount = 0;
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();

    const gitGetCurrentBranch = mock(async () => {
      probeFailureCount += 1;
      throw new Error(`permission denied while reading branch (${probeFailureCount})`);
    });

    const original = {
      gitGetCurrentBranch: workspaceHost.gitGetCurrentBranch,
    };
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;

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
      await triggerFocus();

      expect(harness.getLatest().branchSyncDegraded).toBe(true);
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith("Branch sync probe degraded", {
        description: "[current_branch_probe] permission denied while reading branch (1)",
      });

      await triggerFocus();

      expect(harness.getLatest().branchSyncDegraded).toBe(true);
      expect(toastError).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      workspaceHost.gitGetCurrentBranch = original.gitGetCurrentBranch;
      (toast as { error: typeof toast.error }).error = originalToastError;
      restoreBrowserGlobals();
    }
  });

  test("ignores stale branch probe failures after active repository changes", async () => {
    const setActiveRepo = mock(() => {});
    const branchProbeDeferred = createDeferred<{ name: string | undefined; detached: boolean }>();
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();

    const gitGetCurrentBranch = mock(async () => branchProbeDeferred.promise);

    const original = {
      gitGetCurrentBranch: workspaceHost.gitGetCurrentBranch,
    };
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;

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
      await triggerFocus();

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
      workspaceHost.gitGetCurrentBranch = original.gitGetCurrentBranch;
      (toast as { error: typeof toast.error }).error = originalToastError;
      restoreBrowserGlobals();
    }
  });

  test("clears degraded branch sync state after a successful probe", async () => {
    const setActiveRepo = mock(() => {});
    let shouldFailProbe = true;
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();

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
      gitGetCurrentBranch: workspaceHost.gitGetCurrentBranch,
      gitGetBranches: workspaceHost.gitGetBranches,
    };
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      await triggerFocus();

      expect(harness.getLatest().branchSyncDegraded).toBe(true);

      shouldFailProbe = false;
      await triggerFocus();

      expect(harness.getLatest().branchSyncDegraded).toBe(false);
    } finally {
      await harness.unmount();
      workspaceHost.gitGetCurrentBranch = original.gitGetCurrentBranch;
      workspaceHost.gitGetBranches = original.gitGetBranches;
      restoreBrowserGlobals();
    }
  });

  test("marks branch sync degraded when refresh after branch identity change fails", async () => {
    const setActiveRepo = mock(() => {});
    let currentBranchCallCount = 0;
    let branchesCallCount = 0;
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();

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
      gitGetCurrentBranch: workspaceHost.gitGetCurrentBranch,
      gitGetBranches: workspaceHost.gitGetBranches,
    };
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;

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
      await triggerFocus();

      expect(harness.getLatest().branchSyncDegraded).toBe(true);
      expect(toastError).toHaveBeenCalledWith("Branch sync probe degraded", {
        description: "[branch_refresh] git branches load failed",
      });
    } finally {
      await harness.unmount();
      workspaceHost.gitGetCurrentBranch = original.gitGetCurrentBranch;
      workspaceHost.gitGetBranches = original.gitGetBranches;
      (toast as { error: typeof toast.error }).error = originalToastError;
      restoreBrowserGlobals();
    }
  });

  test("clears branch cache and degraded state on active repository change", async () => {
    const setActiveRepo = mock(() => {});
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();

    const gitGetCurrentBranch = mock(async () => {
      throw new Error("permission denied while reading branch");
    });

    const original = {
      gitGetCurrentBranch: workspaceHost.gitGetCurrentBranch,
    };
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
    });

    try {
      await harness.mount();
      await triggerFocus();

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
      workspaceHost.gitGetCurrentBranch = original.gitGetCurrentBranch;
      restoreBrowserGlobals();
    }
  });
});
