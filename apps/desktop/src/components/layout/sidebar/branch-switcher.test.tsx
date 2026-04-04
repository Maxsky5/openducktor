import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { act, createElement } from "react";
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
      useWorkspaceState: (() => ({
        activeRepo: "/repo",
        workspaces: [],
        activeWorkspace: null,
        addWorkspace: async () => {},
        selectWorkspace: async () => {},
        refreshBranches: async () => {},
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
        loadRepoSettings: async () => {
          throw new Error("loadRepoSettings is not used in this test");
        },
        saveRepoSettings: async () => {
          throw new Error("saveRepoSettings is not used in this test");
        },
        loadSettingsSnapshot: async () => {
          throw new Error("loadSettingsSnapshot is not used in this test");
        },
        detectGithubRepository: async () => {
          throw new Error("detectGithubRepository is not used in this test");
        },
        saveGlobalGitConfig: async () => {
          throw new Error("saveGlobalGitConfig is not used in this test");
        },
        saveSettingsSnapshot: async () => {
          throw new Error("saveSettingsSnapshot is not used in this test");
        },
      })) as AppStateProviderModule["useWorkspaceState"],
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
    switchBranch.mockReset();
    switchBranch.mockImplementation(async () => {});
  });

  afterAll(async () => {
    await restoreMockedModules([
      ["@/state/app-state-provider", () => import("@/state/app-state-provider")],
      [
        "@/components/features/repository/branch-selector",
        () => import("@/components/features/repository/branch-selector"),
      ],
    ]);
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

    const renderBranchSwitcher = (): ReactElement => createElement(BranchSwitcher);
    const rendered = render(renderBranchSwitcher());

    expect(latestOnValueChange).toBeDefined();

    await act(async () => {
      latestOnValueChange?.("feature/desloppify");
    });

    isSwitchingBranch = true;
    await act(async () => {
      rendered.rerender(renderBranchSwitcher());
    });

    expect(rendered.container.innerHTML).toContain('data-branch-value="feature/desloppify"');

    activeBranchName = "feature/desloppify";
    isSwitchingBranch = false;
    await act(async () => {
      deferred.resolve();
      await flush();
    });

    activeBranchName = "release";
    isSwitchingBranch = true;
    await act(async () => {
      rendered.rerender(renderBranchSwitcher());
    });

    expect(rendered.container.innerHTML).toContain('data-branch-value="release"');

    await act(async () => {
      rendered.unmount();
    });
  });
});
