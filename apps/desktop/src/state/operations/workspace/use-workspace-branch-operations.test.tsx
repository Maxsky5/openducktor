import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { useRef } from "react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useWorkspaceBranchOperations } from "./use-workspace-branch-operations";
import {
  createDeferred,
  createWorkspaceHostClient,
  flush,
  IsolatedQueryWrapper,
} from "./workspace-operations-test-utils";
import type { PreparedRepoSwitch } from "./workspace-operations-types";

let workspaceHost = createWorkspaceHostClient();

beforeEach(() => {
  workspaceHost = createWorkspaceHostClient();
});

afterAll(() => {
  mock.restore();
});

type BranchHarnessArgs = {
  activeRepo: string | null;
};

const createBranchHarness = (initialArgs: BranchHarnessArgs) => {
  let latest: ReturnType<typeof useWorkspaceBranchOperations> | null = null;
  let currentArgs = initialArgs;

  const Harness = ({ args }: { args: BranchHarnessArgs }) => {
    const preparedRepoSwitchRef = useRef<PreparedRepoSwitch | null>(null);
    latest = useWorkspaceBranchOperations({
      activeRepo: args.activeRepo,
      hostClient: workspaceHost,
      preparedRepoSwitchRef,
      clearBranchSyncDegraded: () => {},
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
    updateArgs: async (nextArgs: BranchHarnessArgs) => {
      currentArgs = nextArgs;
      await sharedHarness.update({ args: currentArgs });
    },
    run: async (
      fn: (value: ReturnType<typeof useWorkspaceBranchOperations>) => Promise<void> | void,
    ) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      await sharedHarness.run(async () => {
        await fn(latest as ReturnType<typeof useWorkspaceBranchOperations>);
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

describe("use-workspace-branch-operations", () => {
  test("clears branch state on real repository transitions", async () => {
    workspaceHost.gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    workspaceHost.gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ]);

    const harness = createBranchHarness({
      activeRepo: "/repo-a",
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

      await harness.updateArgs({
        activeRepo: "/repo-b",
      });

      expect(harness.getLatest().activeBranch).toBeNull();
      expect(harness.getLatest().branches).toHaveLength(0);
    } finally {
      await harness.unmount();
    }
  });

  test("ignores stale refresh results after the active repository changes", async () => {
    const currentBranchDeferred = createDeferred<{ name: string | undefined; detached: boolean }>();
    workspaceHost.gitGetCurrentBranch = mock(async () => currentBranchDeferred.promise);
    workspaceHost.gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ]);

    const harness = createBranchHarness({
      activeRepo: "/repo-a",
    });

    try {
      await harness.mount();

      let refreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        refreshPromise = value.refreshBranches();
      });

      await harness.updateArgs({
        activeRepo: "/repo-b",
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

      expect(harness.getLatest().activeBranch).toBeNull();
      expect(harness.getLatest().branches).toHaveLength(0);
    } finally {
      currentBranchDeferred.resolve({ name: undefined, detached: false });
      await harness.unmount();
    }
  });

  test("skips no-op branch switches when already attached", async () => {
    const gitSwitchBranch = mock(async (_repoPath: string, branchName: string) => ({
      name: branchName,
      detached: false,
    }));
    workspaceHost.gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    workspaceHost.gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ]);
    workspaceHost.gitSwitchBranch = gitSwitchBranch;

    const harness = createBranchHarness({
      activeRepo: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.run(async (value) => {
        await value.switchBranch("main");
      });

      expect(gitSwitchBranch).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });
});
