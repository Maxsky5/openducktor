import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { WorkspaceRail } from "./workspace-rail";

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

const renderRail = (onOpenRepositoryModal = () => {}): ReturnType<typeof render> =>
  render(
    <WorkspaceStateContext.Provider value={workspaceState}>
      <WorkspaceRail onOpenRepositoryModal={onOpenRepositoryModal} />
    </WorkspaceStateContext.Provider>,
  );

const renderRailMarkup = (): string =>
  renderToStaticMarkup(
    <WorkspaceStateContext.Provider value={workspaceState}>
      <WorkspaceRail onOpenRepositoryModal={() => {}} />
    </WorkspaceStateContext.Provider>,
  );

describe("WorkspaceRail", () => {
  beforeEach(() => {
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
      saveAgentModelFavorites: async () => {
        throw new Error("saveAgentModelFavorites is not used in this test");
      },
      isSwitchingWorkspace: false,
      closedWorkspaces: [],
      incompleteRemovals: [],
      closeWorkspace: async () => {},
      removeWorkspace: async () => {},
      reopenWorkspace: async () => {},
      resolveWorkspacePath: async () => ({ kind: "new" }),
    };
    selectWorkspaceMock.mockClear();
    reorderWorkspacesMock.mockClear();
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

    const html = renderRailMarkup();

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

    renderRail(openRepositoryModal);

    fireEvent.click(screen.getByRole("button", { name: "Beta Repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Alpha Repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));

    expect(selectWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(selectWorkspaceMock).toHaveBeenCalledWith("beta");
    expect(openRepositoryModal).toHaveBeenCalledTimes(1);
  });

  test("retries an incomplete removal from the rail recovery entry", async () => {
    const removeWorkspace = mock(
      async (_input: {
        workspaceId: string;
        expectedRepoPath: string;
        removeTaskWorktrees: boolean;
      }): Promise<void> => {},
    );
    workspaceState.incompleteRemovals = [
      {
        workspace: workspaceRecord("stuck", {
          workspaceName: "Stuck Repo",
          repoPath: "/stuck",
        }),
        record: {
          version: 1,
          operationId: "op-1",
          phase: "attachments",
          removeTaskWorktrees: true,
          removedWorktrees: ["/managed/stuck/task-1"],
          pendingWorktreePath: null,
          startedAt: "2026-01-01T00:00:00.000Z",
          lastFailure: "disk failure",
        },
      },
    ];
    workspaceState.removeWorkspace = removeWorkspace;

    renderRail();

    fireEvent.click(screen.getByRole("button", { name: "Finish removing Stuck Repo" }));
    expect(await screen.findByText("Workspace removal did not finish")).toBeTruthy();
    expect(screen.getByText("disk failure")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry removal" }));

    await waitFor(() =>
      expect(removeWorkspace).toHaveBeenCalledWith({
        workspaceId: "stuck",
        expectedRepoPath: "/stuck",
        removeTaskWorktrees: true,
      }),
    );
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

    renderRail();

    expect(screen.getByRole("button", { name: "Alpha Repo" }).getAttribute("disabled")).toBe(null);
    expect(screen.getByRole("button", { name: "Beta Repo" }).getAttribute("disabled")).toBe(null);
  });
});
