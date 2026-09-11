import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { WorkspaceCloseDialog, WorkspaceRemoveDialog } from "./workspace-lifecycle-dialogs";

const workspace: WorkspaceRecord = {
  workspaceId: "alpha",
  workspaceName: "Alpha Repo",
  repoPath: "/projects/alpha",
  iconDataUrl: undefined,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
};

const closeWorkspace = mock(async (): Promise<void> => {});
const removeWorkspace = mock(async (): Promise<void> => {});

let workspaceState: WorkspaceStateContextValue;

describe("workspace lifecycle dialogs", () => {
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
      selectWorkspace: async () => {},
      reorderWorkspaces: async () => {},
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
      closeWorkspace,
      removeWorkspace,
      reopenWorkspace: async () => {},
      resolveWorkspacePath: async () => ({ kind: "new" }),
    };
    closeWorkspace.mockClear();
    removeWorkspace.mockClear();
  });

  const renderDialog = (dialog: ReactElement): ReturnType<typeof render> =>
    render(
      <WorkspaceStateContext.Provider value={workspaceState}>
        {dialog}
      </WorkspaceStateContext.Provider>,
    );

  test("closes a workspace from an informational dialog", async () => {
    renderDialog(<WorkspaceCloseDialog workspace={workspace} onOpenChange={() => {}} />);

    expect(screen.getByText("Alpha Repo")).toBeTruthy();
    expect(screen.getByText("/projects/alpha")).toBeTruthy();
    expect(screen.getByText(/The workspace disappears from the workspace rail./)).toBeTruthy();
    expect(document.querySelector(".lucide-eye-off")).not.toBe(null);

    fireEvent.click(screen.getByRole("button", { name: "Close workspace" }));

    await waitFor(() =>
      expect(closeWorkspace).toHaveBeenCalledWith({
        workspaceId: "alpha",
        expectedRepoPath: "/projects/alpha",
      }),
    );
  });

  test("removes a workspace with the worktree option off by default", async () => {
    renderDialog(<WorkspaceRemoveDialog workspace={workspace} onOpenChange={() => {}} />);

    expect(
      screen.getByText(/The following items are deleted and cannot be recovered:/),
    ).toBeTruthy();
    const worktreeDescription = screen.getByText(/When checked, task worktrees are deleted/);
    expect(worktreeDescription).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove workspace" }));

    await waitFor(() =>
      expect(removeWorkspace).toHaveBeenCalledWith({
        workspaceId: "alpha",
        expectedRepoPath: "/projects/alpha",
        removeTaskWorktrees: false,
      }),
    );
  });

  test("keeps the worktree description stable when the option changes", async () => {
    renderDialog(<WorkspaceRemoveDialog workspace={workspace} onOpenChange={() => {}} />);

    const descriptionText =
      "When checked, task worktrees are deleted with their local files, including uncommitted and untracked changes. Local branches and committed history remain.";
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText(descriptionText)).toBeTruthy();
    expect(screen.queryByText(/Leave unchecked/)).toBe(null);

    fireEvent.click(screen.getByRole("button", { name: "Remove workspace" }));

    await waitFor(() =>
      expect(removeWorkspace).toHaveBeenCalledWith({
        workspaceId: "alpha",
        expectedRepoPath: "/projects/alpha",
        removeTaskWorktrees: true,
      }),
    );
  });
});
