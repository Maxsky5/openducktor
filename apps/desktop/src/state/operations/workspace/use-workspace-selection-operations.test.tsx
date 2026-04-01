import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { useRef } from "react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useWorkspaceSelectionOperations } from "./use-workspace-selection-operations";
import {
  createWorkspaceHostClient,
  createWorkspaceRuntimeSummary,
  IsolatedQueryWrapper,
  workspace,
} from "./workspace-hook-test-utils";
import type { PreparedRepoSwitch } from "./workspace-operations-types";

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
});
