import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, type PropsWithChildren, useEffect, useSyncExternalStore } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  useWorkspacePreviewTransitionGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import { WorkspaceBranchStateContext } from "@/state/app-state-contexts";
import type { WorkspaceBranchStateContextValue } from "@/types/state-slices";

const actualBranchSelectorModule = await import("@/components/features/repository/branch-selector");
let branchSelectorSpy: { mockRestore(): void };

let branchSyncDegraded = false;
let isSwitchingBranch = false;
let activeBranchName = "main";
let latestOnValueChange: ((value: string) => void) | undefined;
const branchStateListeners = new Set<() => void>();

const switchBranch = mock(async (_branchName: string, _onSwitched?: () => void) => {});

type BranchState = WorkspaceBranchStateContextValue;

let branchState: BranchState;

const resetBranchState = (): void => {
  branchState = {
    activeWorkspace: {
      workspaceId: "workspace-repo",
      workspaceName: "Repo",
      abbreviation: null,
      tileColor: null,
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

const reactActEnvironment: typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
} = globalThis;
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

const importRepositoryBranchSwitcher = async (): Promise<
  typeof import("./repository-branch-switcher").RepositoryBranchSwitcher
> => {
  const { RepositoryBranchSwitcher } = await import("./repository-branch-switcher");
  return RepositoryBranchSwitcher;
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
    <WorkspacePreviewTransitionGuardProvider>
      <WorkspaceBranchStateContext.Provider value={currentBranchState}>
        {children}
      </WorkspaceBranchStateContext.Provider>
    </WorkspacePreviewTransitionGuardProvider>
  );
};

function DenyBranchSwitch() {
  const { register } = useWorkspacePreviewTransitionGuard();
  useEffect(() => register((_apply, cancel) => cancel?.()), [register]);
  return null;
}

function HoldBranchSwitch({
  onRequest,
}: {
  onRequest: (
    apply: () => void | Promise<void | boolean>,
    options: Parameters<ReturnType<typeof useWorkspacePreviewTransitionGuard>["run"]>[2],
  ) => void;
}) {
  const { register } = useWorkspacePreviewTransitionGuard();
  useEffect(
    () => register((apply, _cancel, options) => onRequest(apply, options)),
    [onRequest, register],
  );
  return null;
}

const renderRepositoryBranchSwitcherMarkup = (
  RepositoryBranchSwitcher: typeof import("./repository-branch-switcher").RepositoryBranchSwitcher,
): string =>
  renderToStaticMarkup(
    <BranchStateProvider>
      <RepositoryBranchSwitcher />
    </BranchStateProvider>,
  );

describe("RepositoryBranchSwitcher", () => {
  beforeEach(() => {
    branchSelectorSpy = spyOn(actualBranchSelectorModule, "BranchSelector").mockImplementation(
      ({
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
    );
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

  afterEach(() => {
    branchSelectorSpy.mockRestore();
  });

  test("shows degraded sync status when branch probe failures are active", async () => {
    branchSyncDegraded = true;
    resetBranchState();
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    const html = renderRepositoryBranchSwitcherMarkup(RepositoryBranchSwitcher);

    expect(html).toContain("Branch sync degraded. Auto-refresh may be stale.");
  });

  test("hides degraded sync status when branch probe health is restored", async () => {
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    const html = renderRepositoryBranchSwitcherMarkup(RepositoryBranchSwitcher);

    expect(html).not.toContain("Branch sync degraded. Auto-refresh may be stale.");
  });

  test("keeps the selector enabled while the cached repository branch changes", async () => {
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <RepositoryBranchSwitcher />
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
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <RepositoryBranchSwitcher />
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
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <RepositoryBranchSwitcher />
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
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    const html = renderRepositoryBranchSwitcherMarkup(RepositoryBranchSwitcher);

    expect(html).toContain('data-branch-value="feature/desloppify"');
  });

  test("opens checkout choices from the pencil beside the branch text", async () => {
    branchSelectorSpy.mockRestore();
    updateBranchState({
      branches: [
        { name: "main", isCurrent: true, isRemote: false },
        { name: "release", isCurrent: false, isRemote: false },
      ],
    });
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <RepositoryBranchSwitcher layout="inline" />
      </BranchStateProvider>,
    );
    try {
      expect(screen.getByTitle("Current branch: main").textContent).toBe("main");
      const edit = screen.getByRole("button", { name: "Edit repository branch" });
      expect(edit.textContent).toBe("");
      fireEvent.click(edit);
      expect(screen.getByRole("dialog", { name: "Repository branch" })).toBeTruthy();
      fireEvent.click(await screen.findByRole("option", { name: /release/ }));
      await waitFor(() =>
        expect(switchBranch).toHaveBeenCalledWith("release", expect.any(Function)),
      );
      expect(screen.queryByRole("option", { name: /release/ })).toBeNull();
      expect(screen.getByTitle("Current branch: main").textContent).toBe("main");
    } finally {
      rendered.unmount();
    }
  });

  test("keeps the current branch when the preview guard cancels", async () => {
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <DenyBranchSwitch />
        <RepositoryBranchSwitcher />
      </BranchStateProvider>,
    );

    await act(async () => latestOnValueChange?.("feature"));

    expect(switchBranch).not.toHaveBeenCalled();
    expect(rendered.container.innerHTML).toContain('data-branch-value="main"');
    rendered.unmount();
  });

  test("waits for the preview guard before switching branches", async () => {
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    let applySwitch: (() => void | Promise<void | boolean>) | null = null;
    let switchOptions: Parameters<ReturnType<typeof useWorkspacePreviewTransitionGuard>["run"]>[2];
    const rendered = render(
      <BranchStateProvider>
        <HoldBranchSwitch
          onRequest={(apply, options) => {
            applySwitch = apply;
            switchOptions = options;
          }}
        />
        <RepositoryBranchSwitcher />
      </BranchStateProvider>,
    );

    await act(async () => latestOnValueChange?.("feature"));
    expect(switchBranch).not.toHaveBeenCalled();
    expect(applySwitch).not.toBeNull();
    expect(switchOptions).toEqual({ waitForSuccess: true, kind: "root_branch_switch" });
    await act(async () => applySwitch?.());
    expect(switchBranch).toHaveBeenCalledWith("feature", expect.any(Function));
    rendered.unmount();
  });

  test("tells the preview guard whether checkout switched the branch", async () => {
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    let applySwitch: (() => void | Promise<void | boolean>) | null = null;
    const rendered = render(
      <BranchStateProvider>
        <HoldBranchSwitch onRequest={(apply) => (applySwitch = apply)} />
        <RepositoryBranchSwitcher />
      </BranchStateProvider>,
    );
    try {
      switchBranch.mockImplementationOnce(async () => {});
      await act(async () => latestOnValueChange?.("feature"));
      await act(async () => expect(await applySwitch?.()).toBe(false));

      switchBranch.mockImplementationOnce(async (_branchName, onSwitched) => onSwitched?.());
      await act(async () => latestOnValueChange?.("feature"));
      await act(async () => expect(await applySwitch?.()).toBe(true));
    } finally {
      rendered.unmount();
    }
  });

  test("clears pending branch state after a successful switch completes", async () => {
    const deferred = createDeferred<void>();
    switchBranch.mockImplementation(() => deferred.promise);
    resetBranchState();
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();

    const rendered = render(
      <BranchStateProvider>
        <RepositoryBranchSwitcher />
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
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <RepositoryBranchSwitcher />
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
            abbreviation: null,
            tileColor: null,
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
    const RepositoryBranchSwitcher = await importRepositoryBranchSwitcher();
    const rendered = render(
      <BranchStateProvider>
        <RepositoryBranchSwitcher />
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
