import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

let branchSyncDegraded = false;
let isSwitchingWorkspace = false;
let isSwitchingBranch = false;
let activeBranchName = "main";
let latestOnValueChange: ((value: string) => void) | undefined;

const switchBranch = mock(async (_branchName: string) => {});

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
  beforeAll(() => {
    mock.module("@/state/app-state-provider", () => ({
      AppStateProvider: ({ children }: { children: ReactElement }) => children,
      useAgentState: () => {
        throw new Error("useAgentState is not used in this test");
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
      useWorkspaceState: () => ({
        activeRepo: "/repo",
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
      }),
    }));

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

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    branchSyncDegraded = false;
    isSwitchingWorkspace = false;
    isSwitchingBranch = false;
    activeBranchName = "main";
    latestOnValueChange = undefined;
    switchBranch.mockReset();
    switchBranch.mockImplementation(async () => {});
  });

  test("shows degraded sync status when branch probe failures are active", async () => {
    branchSyncDegraded = true;
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
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).toContain('data-disabled="true"');
  });

  test("uses the active branch name on the first render", async () => {
    activeBranchName = "feature/desloppify";
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).toContain('data-branch-value="feature/desloppify"');
  });

  test("clears pending branch state after a successful switch completes", async () => {
    const deferred = createDeferred<void>();
    switchBranch.mockImplementation(() => deferred.promise);
    const { BranchSwitcher } = await import("./branch-switcher");

    let renderer: ReactTestRenderer | null = null;
    const render = (): ReactElement => createElement(BranchSwitcher);

    await act(async () => {
      renderer = TestRenderer.create(render());
    });

    if (!renderer) {
      throw new Error("Expected branch switcher renderer to mount");
    }
    const mountedRenderer: ReactTestRenderer = renderer;

    expect(latestOnValueChange).toBeDefined();

    await act(async () => {
      latestOnValueChange?.("feature/desloppify");
    });

    isSwitchingBranch = true;
    await act(async () => {
      mountedRenderer.update(render());
    });

    expect(
      mountedRenderer.root.findByProps({
        "data-branch-value": "feature/desloppify",
      }),
    ).toBeTruthy();

    activeBranchName = "feature/desloppify";
    isSwitchingBranch = false;
    await act(async () => {
      deferred.resolve();
      await flush();
    });

    activeBranchName = "release";
    isSwitchingBranch = true;
    await act(async () => {
      mountedRenderer.update(render());
    });

    expect(
      mountedRenderer.root.findByProps({
        "data-branch-value": "release",
      }),
    ).toBeTruthy();

    await act(async () => {
      mountedRenderer.unmount();
    });
  });
});
