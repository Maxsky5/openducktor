import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { useRef } from "react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useWorkspaceSelectionOperations } from "./use-workspace-selection-operations";
import {
  createDeferred,
  createWorkspaceHostClient,
  createWorkspaceRuntimeSummary,
  IsolatedQueryWrapper,
  workspace,
} from "./workspace-hook-test-utils";
import type { PreparedRepoSwitch } from "./workspace-operations-types";

type EmptyObject = Record<string, never>;

type RepoConfigFixture = {
  defaultRuntimeKind: "opencode";
  branchPrefix: string;
  defaultTargetBranch: { remote: string; branch: string };
  git: { providers: Record<string, never> };
  trustedHooks: boolean;
  hooks: { preStart: []; postComplete: [] };
  devServers: [];
  worktreeFileCopies: [];
  promptOverrides: EmptyObject;
  agentDefaults: EmptyObject;
};

let workspaceHost = createWorkspaceHostClient();

beforeEach(() => {
  workspaceHost = createWorkspaceHostClient();
});

afterAll(() => {
  mock.restore();
});

type SelectionHarnessArgs = {
  activeRepo: string | null;
  setActiveRepo: (repoPath: string | null) => void;
  clearTaskData: () => void;
  clearActiveBeadsCheck: () => void;
  clearBranchData: () => void;
};

const createSelectionHarness = (initialArgs: SelectionHarnessArgs) => {
  let latest: ReturnType<typeof useWorkspaceSelectionOperations> | null = null;
  const currentArgs = initialArgs;

  const Harness = ({ args }: { args: SelectionHarnessArgs }) => {
    const preparedRepoSwitchRef = useRef<PreparedRepoSwitch | null>(null);
    latest = useWorkspaceSelectionOperations({
      ...args,
      hostClient: workspaceHost,
      preparedRepoSwitchRef,
    });
    return null;
  };

  const sharedHarness = createHookHarness(
    Harness,
    { args: currentArgs },
    { wrapper: IsolatedQueryWrapper },
  );

  return {
    mount: async () => {
      await sharedHarness.mount();
    },
    run: async (
      fn: (value: ReturnType<typeof useWorkspaceSelectionOperations>) => Promise<void> | void,
    ) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      await sharedHarness.run(async () => {
        await fn(latest as ReturnType<typeof useWorkspaceSelectionOperations>);
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

describe("use-workspace-selection-operations", () => {
  test("trims repo paths before adding a workspace", async () => {
    const workspaceAdd = mock(
      async (): Promise<ReturnType<typeof workspace>> => workspace("/repo-new"),
    );
    const workspaceList = mock(async () => [workspace("/repo-new", true)]);
    workspaceHost.workspaceAdd = workspaceAdd;
    workspaceHost.workspaceList = workspaceList;

    const harness = createSelectionHarness({
      activeRepo: null,
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
      clearBranchData: () => {},
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

  test("clears dependent state before committing a successful repo switch", async () => {
    const callOrder: string[] = [];
    const setActiveRepo = mock((repoPath: string | null) => {
      callOrder.push(`setActiveRepo:${repoPath}`);
    });
    const clearTaskData = mock(() => {
      callOrder.push("clearTaskData");
    });
    const clearActiveBeadsCheck = mock(() => {
      callOrder.push("clearActiveBeadsCheck");
    });
    const clearBranchData = mock(() => {
      callOrder.push("clearBranchData");
    });

    workspaceHost.workspaceSelect = mock(async () => workspace("/repo-a", true));
    workspaceHost.workspaceList = mock(async () => [workspace("/repo-a", true)]);
    workspaceHost.workspaceGetRepoConfig = mock(async () => ({
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
    }));
    workspaceHost.runtimeEnsure = mock(async () => createWorkspaceRuntimeSummary("/repo-a"));

    const harness = createSelectionHarness({
      activeRepo: "/repo-old",
      setActiveRepo,
      clearTaskData,
      clearActiveBeadsCheck,
      clearBranchData,
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.selectWorkspace("/repo-a");
      });

      expect(callOrder.slice(0, 4)).toEqual([
        "clearTaskData",
        "clearActiveBeadsCheck",
        "clearBranchData",
        "setActiveRepo:/repo-a",
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("clears previous active workspaces when merging a new active record", async () => {
    const setActiveRepo = mock((_repoPath: string | null) => {});
    const harness = createSelectionHarness({
      activeRepo: "/repo-old",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.run((value) => {
        value.applyWorkspaceRecords([workspace("/repo-old", true), workspace("/repo-b")]);
      });
      await harness.run((value) => {
        value.applyWorkspaceRecord(workspace("/repo-c", true));
      });

      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-b"),
        workspace("/repo-c", true),
        workspace("/repo-old", false),
      ]);
      expect(setActiveRepo).toHaveBeenCalledWith("/repo-c");
    } finally {
      await harness.unmount();
    }
  });

  test("skips stale runtime ensure calls after a newer workspace switch starts", async () => {
    const repoAConfigDeferred = createDeferred<RepoConfigFixture>();
    const runtimeEnsure = mock(async (repoPath: string) => createWorkspaceRuntimeSummary(repoPath));
    const workspaceList = mock(async () => [workspace("/repo-a", true)]);
    workspaceList.mockImplementationOnce(async () => [workspace("/repo-a", true)]);
    workspaceList.mockImplementationOnce(async () => [workspace("/repo-b", true)]);
    workspaceHost.workspaceSelect = mock(async (repoPath: string) => workspace(repoPath, true));
    workspaceHost.workspaceList = workspaceList;
    workspaceHost.workspaceGetRepoConfig = mock(async (repoPath: string) => {
      if (repoPath === "/repo-a") {
        return repoAConfigDeferred.promise;
      }

      return {
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
      };
    });
    workspaceHost.runtimeEnsure = runtimeEnsure;

    const harness = createSelectionHarness({
      activeRepo: "/repo-old",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveBeadsCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.selectWorkspace("/repo-a");
      });
      await harness.run(async (value) => {
        await value.selectWorkspace("/repo-b");
      });

      repoAConfigDeferred.resolve({
        defaultRuntimeKind: "opencode",
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
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(runtimeEnsure).toHaveBeenCalledTimes(1);
      expect(runtimeEnsure).toHaveBeenCalledWith("/repo-b", "opencode");
    } finally {
      repoAConfigDeferred.resolve({
        defaultRuntimeKind: "opencode",
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
      });
      await harness.unmount();
    }
  });
});
