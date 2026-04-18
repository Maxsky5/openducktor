import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type AppStateProviderModule,
  createAppStateProviderModuleMock,
} from "@/test-utils/app-state-provider-mock";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { WorkspaceStateContextValue } from "@/types/state-slices";

const selectWorkspaceMock = mock(async (_workspaceId: string): Promise<void> => {});
const reorderWorkspacesMock = mock(async (_workspaceIds: string[]): Promise<void> => {});

const workspaceRecord = (
  workspaceId: string,
  options: Partial<WorkspaceRecord> = {},
): WorkspaceRecord => ({
  workspaceId,
  workspaceName: options.workspaceName ?? workspaceId.toUpperCase(),
  repoPath: options.repoPath ?? `/${workspaceId}`,
  iconDataUrl: options.iconDataUrl,
  isActive: options.isActive ?? false,
  hasConfig: options.hasConfig ?? true,
  configuredWorktreeBasePath: options.configuredWorktreeBasePath ?? null,
  defaultWorktreeBasePath: options.defaultWorktreeBasePath ?? null,
  effectiveWorktreeBasePath: options.effectiveWorktreeBasePath ?? null,
});

let workspaceState: WorkspaceStateContextValue;
let WorkspaceRail: typeof import("./workspace-rail").WorkspaceRail;

describe("WorkspaceRail", () => {
  beforeEach(async () => {
    workspaceState = {
      isLoadingBranches: false,
      isSwitchingBranch: false,
      branchSyncDegraded: false,
      workspaces: [],
      activeWorkspace: null,
      branches: [],
      activeBranch: null,
      addWorkspace: async () => {},
      selectWorkspace: selectWorkspaceMock,
      reorderWorkspaces: reorderWorkspacesMock,
      refreshBranches: async () => {},
      switchBranch: async () => {},
      loadRepoSettings: async () => {
        throw new Error("loadRepoSettings is not used in this test");
      },
      saveRepoSettings: async () => {},
      loadSettingsSnapshot: async () => {
        throw new Error("loadSettingsSnapshot is not used in this test");
      },
      detectGithubRepository: async () => null,
      saveGlobalGitConfig: async () => {},
      saveSettingsSnapshot: async () => {},
      isSwitchingWorkspace: false,
    };
    selectWorkspaceMock.mockClear();
    reorderWorkspacesMock.mockClear();

    mock.module("@/state/app-state-provider", () =>
      createAppStateProviderModuleMock({
        useWorkspaceState: (() => workspaceState) as AppStateProviderModule["useWorkspaceState"],
      }),
    );

    ({ WorkspaceRail } = await import("./workspace-rail"));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/state/app-state-provider", () => import("@/state/app-state-provider")],
    ]);
  });

  test("renders icon and initials variants with hidden-scrollbar overflow", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        iconDataUrl: "data:image/png;base64,AAAA",
        isActive: true,
      }),
      workspaceRecord("open-ducktor", {
        workspaceName: "Open Ducktor",
      }),
    ];

    const html = renderToStaticMarkup(<WorkspaceRail onOpenRepositoryModal={() => {}} />);

    expect(html).toContain("hide-scrollbar");
    expect(html).toContain('aria-label="Alpha Repo"');
    expect(html).toContain('aria-label="Open Ducktor"');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain(">OD<");
  });

  test("switches inactive workspaces and exposes the open-repository button", async () => {
    const openRepositoryModal = mock(() => {});
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        isActive: true,
      }),
      workspaceRecord("beta", {
        workspaceName: "Beta Repo",
      }),
    ];

    render(<WorkspaceRail onOpenRepositoryModal={openRepositoryModal} />);

    fireEvent.click(screen.getByRole("button", { name: "Beta Repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Alpha Repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));

    expect(selectWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(selectWorkspaceMock).toHaveBeenCalledWith("beta");
    expect(openRepositoryModal).toHaveBeenCalledTimes(1);
  });

  test("keeps buttons interactive-looking while a workspace switch is pending", () => {
    workspaceState.isSwitchingWorkspace = true;
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        isActive: true,
      }),
      workspaceRecord("beta", {
        workspaceName: "Beta Repo",
      }),
    ];

    render(<WorkspaceRail onOpenRepositoryModal={() => {}} />);

    expect(screen.getByRole("button", { name: "Alpha Repo" }).getAttribute("disabled")).toBe(null);
    expect(screen.getByRole("button", { name: "Beta Repo" }).getAttribute("disabled")).toBe(null);
  });
});
