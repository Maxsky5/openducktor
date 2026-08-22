import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { act, type PropsWithChildren, useSyncExternalStore } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceBranchStateContext } from "@/state/app-state-contexts";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { WorkspaceBranchStateContextValue } from "@/types/state-slices";

const actualBranchSelectorModule = await import("@/components/features/repository/branch-selector");

let branchSyncDegraded = false;
let isSwitchingBranch = false;
let activeBranchName = "main";
let latestOnValueChange: ((value: string) => void) | undefined;
const branchStateListeners = new Set<() => void>();

const switchBranch = mock(async (_branchName: string) => {});

type BranchState = WorkspaceBranchStateContextValue;

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

// SAFETY: This test controls the fixture and supplies `typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; }` used by this case.
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
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const restoreBranchSwitcherMocks = async (): Promise<void> => {
  await restoreMockedModules([
    ["@/components/features/repository/branch-selector", async () => actualBranchSelectorModule],
  ]);
};

const importBranchSwitcher = async (): Promise<
  typeof import("./branch-switcher").BranchSwitcher
> => {
  const { BranchSwitcher } = await import("./branch-switcher");
  await restoreBranchSwitcherMocks();
  return BranchSwitcher;
};

const BranchStateProvider = ({ children }: PropsWithChildren) => {
  const currentBranchState = useSyncExternalStore(
    (listener) => {
      branchStateListeners.add(listener);
      return () => branchStateListeners.delete(listener);
    },
    () => branchState,
    () => branchState,
  );

  return (
    <WorkspaceBranchStateContext.Provider value={currentBranchState}>
      {children}
    </WorkspaceBranchStateContext.Provider>
  );
};

const renderBranchSwitcherMarkup = (
  BranchSwitcher: typeof import("./branch-switcher").BranchSwitcher,
): string =>
  renderToStaticMarkup(
    <BranchStateProvider>
      <BranchSwitcher />
    </BranchStateProvider>,
  );

describe("BranchSwitcher", () => {
  beforeEach(() => {
    mock.module("@/components/features/repository/branch-selector", () => ({
      BranchSelector: ({
        value,
        disabled,
        placeholder,
        onValueChange,
      }: {
        value: string;
        disabled?: boolean;
        placeholder?: string;
        onValueChange?: (value: string) => void;
      }) => {
        latestOnValueChange = onValueChange;
        return (
          <div
            data-branch-value={value}
            data-disabled={disabled ? "true" : "false"}
            data-placeholder={placeholder}
          />
        );
      },
    }));
  });

  beforeEach(() => {
    branchSyncDegraded = false;
    isSwitchingBranch = false;
    activeBranchName = "main";
    latestOnValueChange = undefined;
    branchStateListeners.clear();
    switchBranch.mockReset();
    switchBranch.mockImplementation(async () => {});
    resetBranchState();
  });

  afterEach(async () => {
    await restoreBranchSwitcherMocks();
  });

  test("shows degraded sync status when branch probe failures are active", async () => {
    branchSyncDegraded = true;
    resetBranchState();
    const BranchSwitcher = await importBranchSwitcher();
    const html = renderBranchSwitcherMarkup(BranchSwitcher);

    expect(html).toContain("Branch sync degraded. Auto-refresh may be stale.");
  });

  test("hides degraded sync status when branch probe health is restored", async () => {
    const BranchSwitcher = await importBranchSwitcher();
    const html = renderBranchSwitcherMarkup(BranchSwitcher);

    expect(html).not.toContain("Branch sync degraded. Auto-refresh may be stale.");
  });

  test("keeps the selector enabled while the cached repository branch changes", async () => {
    const BranchSwitcher = await importBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <BranchSwitcher />
      </BranchStateProvider>,
    );
    const expectStableBranchSelector = (branchName: string): void => {
      const selector = rendered.container.querySelector(`[data-branch-value="${branchName}"]`);
      expect(selector?.getAttribute("data-disabled")).toBe("false");
    };

    expectStableBranchSelector("main");

    await act(async () => {
      updateBranchState({
        branches: [
          {
            name: "develop",
            isCurrent: true,
            isRemote: false,
          },
        ],
        activeBranch: {
          name: "develop",
          detached: false,
        },
      });
    });

    expectStableBranchSelector("develop");

    await act(async () => {
      rendered.unmount();
    });
  });

  test("disables the selector and shows loading on an uncached first load", async () => {
    resetBranchState();
    updateBranchState({
      branches: [],
      activeBranch: null,
      isLoadingBranches: true,
    });
    const BranchSwitcher = await importBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <BranchSwitcher />
      </BranchStateProvider>,
    );

    const selector = rendered.container.querySelector('[data-disabled="true"]');
    expect(selector?.getAttribute("data-placeholder")).toBe("Loading branches...");

    await act(async () => {
      rendered.unmount();
    });
  });

  test("disables the selector when the repository has no branches", async () => {
    resetBranchState();
    updateBranchState({
      branches: [],
      activeBranch: null,
      isLoadingBranches: false,
    });
    const BranchSwitcher = await importBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <BranchSwitcher />
      </BranchStateProvider>,
    );

    const selector = rendered.container.querySelector('[data-disabled="true"]');
    expect(selector?.getAttribute("data-placeholder")).toBe("Select branch...");

    await act(async () => {
      rendered.unmount();
    });
  });

  test("uses the active branch name on the first render", async () => {
    activeBranchName = "feature/desloppify";
    resetBranchState();
    const BranchSwitcher = await importBranchSwitcher();
    const html = renderBranchSwitcherMarkup(BranchSwitcher);

    expect(html).toContain('data-branch-value="feature/desloppify"');
  });

  test("clears pending branch state after a successful switch completes", async () => {
    const deferred = createDeferred<void>();
    switchBranch.mockImplementation(() => deferred.promise);
    resetBranchState();
    const BranchSwitcher = await importBranchSwitcher();

    const rendered = render(
      <BranchStateProvider>
        <BranchSwitcher />
      </BranchStateProvider>,
    );

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

  test("keeps the active repository pending branch when an inactive switch completes", async () => {
    const repoASwitch = createDeferred<void>();
    const repoBSwitch = createDeferred<void>();
    switchBranch.mockImplementation((branchName: string) =>
      branchName === "feature/repo-a" ? repoASwitch.promise : repoBSwitch.promise,
    );
    resetBranchState();
    const BranchSwitcher = await importBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <BranchSwitcher />
      </BranchStateProvider>,
    );

    try {
      await act(async () => {
        latestOnValueChange?.("feature/repo-a");
        updateBranchState({ isSwitchingBranch: true });
      });
      expect(
        rendered.container.querySelector('[data-branch-value="feature/repo-a"]'),
      ).not.toBeNull();

      await act(async () => {
        updateBranchState({
          activeWorkspace: {
            workspaceId: "workspace-repo-b",
            workspaceName: "Repo B",
            repoPath: "/repo-b",
            isActive: true,
            hasConfig: true,
            configuredWorktreeBasePath: null,
            defaultWorktreeBasePath: "/tmp/default-worktrees",
            effectiveWorktreeBasePath: "/tmp/default-worktrees",
          },
          branches: [
            { name: "release", isCurrent: true, isRemote: false },
            { name: "feature/repo-b", isCurrent: false, isRemote: false },
          ],
          activeBranch: { name: "release", detached: false },
          isSwitchingBranch: false,
        });
      });
      await act(async () => {
        latestOnValueChange?.("feature/repo-b");
        updateBranchState({ isSwitchingBranch: true });
      });
      expect(
        rendered.container.querySelector('[data-branch-value="feature/repo-b"]'),
      ).not.toBeNull();

      await act(async () => {
        repoASwitch.resolve();
        await flush();
      });

      expect(
        rendered.container.querySelector('[data-branch-value="feature/repo-b"]'),
      ).not.toBeNull();
    } finally {
      repoASwitch.resolve();
      repoBSwitch.resolve();
      await act(async () => {
        await flush();
        rendered.unmount();
      });
    }
  });

  test("restores the active branch after a switch fails", async () => {
    const deferred = createDeferred<void>();
    switchBranch.mockImplementationOnce(() => deferred.promise);
    resetBranchState();
    const BranchSwitcher = await importBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <BranchSwitcher />
      </BranchStateProvider>,
    );

    await act(async () => {
      latestOnValueChange?.("feature/desloppify");
      updateBranchState({ isSwitchingBranch: true });
    });
    expect(
      rendered.container.querySelector('[data-branch-value="feature/desloppify"]'),
    ).not.toBeNull();

    await act(async () => {
      deferred.reject(new Error("checkout failed"));
      updateBranchState({ isSwitchingBranch: false });
      await flush();
    });
    expect(rendered.container.querySelector('[data-branch-value="main"]')).not.toBeNull();

    await act(async () => {
      rendered.unmount();
    });
  });
});
