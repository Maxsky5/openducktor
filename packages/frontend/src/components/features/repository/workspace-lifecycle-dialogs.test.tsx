import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { IncompleteWorkspaceRemoval, WorkspaceRecord } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import {
  WorkspaceCloseDialog,
  WorkspaceRemovalRecoveryDialog,
  WorkspaceRemoveDialog,
} from "./workspace-lifecycle-dialogs";

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
    expect(screen.getByText(/The workspace is hidden until you reopen it./)).toBeTruthy();
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

  test("lets the recovery dialog finish removal without task worktrees", async () => {
    const removal: IncompleteWorkspaceRemoval = {
      workspace,
      record: {
        version: 1,
        operationId: "op-1",
        removeTaskWorktrees: true,
        phase: "worktrees",
        removedWorktrees: [],
        pendingWorktreePath: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        lastFailure: null,
      },
    };
    renderDialog(<WorkspaceRemovalRecoveryDialog removal={removal} onOpenChange={() => {}} />);

    expect(screen.getByText(/Task worktrees are part of this removal./)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText(/Task worktrees are kept./)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry removal" }));

    await waitFor(() =>
      expect(removeWorkspace).toHaveBeenCalledWith({
        workspaceId: "alpha",
        expectedRepoPath: "/projects/alpha",
        removeTaskWorktrees: false,
      }),
    );
  });

  test("keeps the recorded choice when the recovery already removed worktrees", async () => {
    const removal: IncompleteWorkspaceRemoval = {
      workspace,
      record: {
        version: 1,
        operationId: "op-1",
        removeTaskWorktrees: true,
        phase: "worktrees",
        removedWorktrees: ["/managed/alpha/task-1"],
        pendingWorktreePath: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        lastFailure: null,
      },
    };
    renderDialog(<WorkspaceRemovalRecoveryDialog removal={removal} onOpenChange={() => {}} />);

    expect(screen.queryByRole("checkbox")).toBe(null);

    fireEvent.click(screen.getByRole("button", { name: "Retry removal" }));

    await waitFor(() =>
      expect(removeWorkspace).toHaveBeenCalledWith({
        workspaceId: "alpha",
        expectedRepoPath: "/projects/alpha",
        removeTaskWorktrees: true,
      }),
    );
  });

  test("keeps the recorded choice while a worktree deletion is pending", async () => {
    const removal: IncompleteWorkspaceRemoval = {
      workspace,
      record: {
        version: 1,
        operationId: "op-1",
        removeTaskWorktrees: true,
        phase: "worktrees",
        removedWorktrees: [],
        pendingWorktreePath: "/managed/alpha/task-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        lastFailure: null,
      },
    };
    renderDialog(<WorkspaceRemovalRecoveryDialog removal={removal} onOpenChange={() => {}} />);

    expect(screen.queryByRole("checkbox")).toBe(null);

    fireEvent.click(screen.getByRole("button", { name: "Retry removal" }));

    await waitFor(() =>
      expect(removeWorkspace).toHaveBeenCalledWith({
        workspaceId: "alpha",
        expectedRepoPath: "/projects/alpha",
        removeTaskWorktrees: true,
      }),
    );
  });

  test("locks the worktree choice after a failed removal attempt", async () => {
    removeWorkspace.mockImplementationOnce(async () => {
      throw new Error("disk failure");
    });
    renderDialog(<WorkspaceRemoveDialog workspace={workspace} onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Remove workspace" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Remove workspace" }));

    await waitFor(() =>
      expect(removeWorkspace).toHaveBeenLastCalledWith({
        workspaceId: "alpha",
        expectedRepoPath: "/projects/alpha",
        removeTaskWorktrees: true,
      }),
    );
  });

  test("locks the worktree choice after a failed recovery retry", async () => {
    const removal: IncompleteWorkspaceRemoval = {
      workspace,
      record: {
        version: 1,
        operationId: "op-1",
        removeTaskWorktrees: false,
        phase: "worktrees",
        removedWorktrees: [],
        pendingWorktreePath: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        lastFailure: null,
      },
    };
    removeWorkspace.mockImplementationOnce(async () => {
      throw new Error("disk failure");
    });
    renderDialog(<WorkspaceRemovalRecoveryDialog removal={removal} onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Retry removal" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry removal" }));

    await waitFor(() =>
      expect(removeWorkspace).toHaveBeenLastCalledWith({
        workspaceId: "alpha",
        expectedRepoPath: "/projects/alpha",
        removeTaskWorktrees: true,
      }),
    );
  });
});
