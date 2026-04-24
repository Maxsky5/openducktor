import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { act, createElement, useSyncExternalStore } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type AppStateProviderModule,
  createAppStateProviderModuleMock,
} from "@/test-utils/app-state-provider-mock";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

let branchSyncDegraded = false;
let isSwitchingWorkspace = false;
let isSwitchingBranch = false;
let activeBranchName = "main";
let latestOnValueChange: ((value: string) => void) | undefined;
const branchStateListeners = new Set<() => void>();

const switchBranch = mock(async (_branchName: string) => {});

type BranchState = ReturnType<AppStateProviderModule["useWorkspaceBranchState"]>;

let branchState: BranchState;

const resetBranchState = (): void => {
  branchState = {
    activeWorkspace: {
      workspaceId: "workspace-repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      isActive: true,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: "/tmp/default-worktrees",
      effectiveWorktreeBasePath: "/tmp/default-worktrees",
    },
    branches: [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ],
    activeBranch: {
      name: activeBranchName,
      detached: false,
    },
    isSwitchingWorkspace,
    isLoadingBranches: false,
    isSwitchingBranch,
    branchSyncDegraded,
    switchBranch,
  };
};

const updateBranchState = (nextState: Partial<BranchState>): void => {
  branchState = {
    ...branchState,
    ...nextState,
  };

  for (const listener of branchStateListeners) {
    listener();
  }
};

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe("BranchSwitcher", () => {
  beforeEach(() => {
    const stateModule = createAppStateProviderModuleMock({
      useAgentState: () => {
        throw new Error("useAgentState is not used in this test");
      },
      useAgentOperations: () => {
        throw new Error("useAgentOperations is not used in this test");
      },
      useAgentSessions: () => {
        throw new Error("useAgentSessions is not used in this test");
      },
      useAgentSessionSummaries: () => {
        throw new Error("useAgentSessionSummaries is not used in this test");
      },
      useAgentSession: () => {
        throw new Error("useAgentSession is not used in this test");
      },
      useChecksState: () => {
        throw new Error("useChecksState is not used in this test");
      },
      useSpecState: () => {
        throw new Error("useSpecState is not used in this test");
      },
      useTasksState: () => {
        throw new Error("useTasksState is not used in this test");
      },
      useWorkspaceBranchState: (() =>
        useSyncExternalStore(
          (listener) => {
            branchStateListeners.add(listener);
            return () => branchStateListeners.delete(listener);
          },
          () => branchState,
          () => branchState,
        )) as AppStateProviderModule["useWorkspaceBranchState"],
    });

    mock.module("@/state/app-state-provider", () => stateModule);

    mock.module("@/components/features/repository/branch-selector", () => ({
      BranchSelector: ({
        value,
        disabled,
        onValueChange,
      }: {
        value: string;
        disabled?: boolean;
        onValueChange?: (value: string) => void;
      }) => {
        latestOnValueChange = onValueChange;
        return <div data-branch-value={value} data-disabled={disabled ? "true" : "false"} />;
      },
    }));
  });

  beforeEach(() => {
    branchSyncDegraded = false;
    isSwitchingWorkspace = false;
    isSwitchingBranch = false;
    activeBranchName = "main";
    latestOnValueChange = undefined;
    branchStateListeners.clear();
    switchBranch.mockReset();
    switchBranch.mockImplementation(async () => {});
    resetBranchState();
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/state/app-state-provider", () => import("../../../state/app-state-provider")],
      [
        "@/components/features/repository/branch-selector",
        () => import("@/components/features/repository/branch-selector"),
      ],
    ]);
  });

  test("shows degraded sync status when branch probe failures are active", async () => {
    branchSyncDegraded = true;
    resetBranchState();
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).toContain("Branch sync degraded. Auto-refresh may be stale.");
  });

  test("hides degraded sync status when branch probe health is restored", async () => {
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).not.toContain("Branch sync degraded. Auto-refresh may be stale.");
  });

  test("disables branch selection while switching repositories", async () => {
    isSwitchingWorkspace = true;
    resetBranchState();
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).toContain('data-disabled="true"');
  });

  test("uses the active branch name on the first render", async () => {
    activeBranchName = "feature/desloppify";
    resetBranchState();
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).toContain('data-branch-value="feature/desloppify"');
  });

  test("clears pending branch state after a successful switch completes", async () => {
    const deferred = createDeferred<void>();
    switchBranch.mockImplementation(() => deferred.promise);
    resetBranchState();
    const { BranchSwitcher } = await import("./branch-switcher");

    const renderBranchSwitcher = (): ReactElement => createElement(BranchSwitcher);
    const rendered = render(renderBranchSwitcher());

    expect(latestOnValueChange).toBeDefined();

    await act(async () => {
      latestOnValueChange?.("feature/desloppify");
    });

    await act(async () => {
      isSwitchingBranch = true;
      updateBranchState({ isSwitchingBranch: true });
    });

    expect(rendered.container.innerHTML).toContain('data-branch-value="feature/desloppify"');

    await act(async () => {
      activeBranchName = "feature/desloppify";
      isSwitchingBranch = false;
      updateBranchState({
        activeBranch: {
          name: activeBranchName,
          detached: false,
        },
        isSwitchingBranch: false,
      });
      deferred.resolve();
      await flush();
    });

    await act(async () => {
      activeBranchName = "release";
      isSwitchingBranch = true;
      updateBranchState({
        activeBranch: {
          name: activeBranchName,
          detached: false,
        },
        isSwitchingBranch: true,
      });
    });

    expect(rendered.container.innerHTML).toContain('data-branch-value="release"');

    await act(async () => {
      rendered.unmount();
    });
  });
});
