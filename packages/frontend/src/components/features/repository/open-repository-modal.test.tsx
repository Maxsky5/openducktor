import { describe, expect, mock, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode, useEffect } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { OpenRepositoryModal } from "./open-repository-modal";

enableReactActEnvironment();

const addWorkspaceMock = mock(
  async (_input: {
    workspaceId: string;
    workspaceName: string;
    repoPath: string;
  }): Promise<void> => {},
);
const selectWorkspaceMock = mock(async (_repoPath: string): Promise<void> => {});

const createWorkspaceStateValue = (
  overrides: Partial<WorkspaceStateContextValue> = {},
): WorkspaceStateContextValue => ({
  activeWorkspace: null,
  workspaces: [],
  branches: [],
  activeBranch: null,
  isSwitchingWorkspace: false,
  closedWorkspaces: [],
  incompleteRemovals: [],
  closeWorkspace: async () => {},
  removeWorkspace: async () => {},
  reopenWorkspace: async () => {},
  resolveWorkspacePath: async () => ({ kind: "new" }),
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  addWorkspace: addWorkspaceMock,
  selectWorkspace: selectWorkspaceMock,
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
  ...overrides,
});

function SeedFilesystemDirectory(): ReactNode {
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.setQueryData(filesystemQueryKeys.directory(), {
      currentPath: "/repo",
      currentPathIsGitRepo: true,
      parentPath: "/",
      homePath: "/repo",
      entries: [],
    });
  }, [queryClient]);

  return null;
}

describe("OpenRepositoryModal", () => {
  test("resets repository creation fields when the modal reopens", async () => {
    const onOpenChange = mock((_open: boolean) => {});
    const workspaceState = createWorkspaceStateValue();
    const modal = (open: boolean) => (
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider value={workspaceState}>
          <SeedFilesystemDirectory />
          <OpenRepositoryModal open={open} canClose onOpenChange={onOpenChange} />
        </WorkspaceStateContext.Provider>
      </QueryProvider>
    );
    const view = render(modal(true));

    fireEvent.click(screen.getByRole("button", { name: /choose repository folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));
    expect((await screen.findByLabelText<HTMLInputElement>("Repository path")).value).toBe("/repo");

    view.rerender(modal(false));
    view.rerender(modal(true));

    expect(await screen.findByRole("button", { name: /choose repository folder/i })).toBeTruthy();
    expect(screen.queryByLabelText("Repository path")).toBeNull();
    view.unmount();
  });

  test("derives a free workspace ID when a closed workspace holds the derived ID", async () => {
    const closedWorkspace = {
      workspaceId: "repo",
      workspaceName: "Hidden repo",
      repoPath: "/other",
      isActive: false,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: null,
      effectiveWorktreeBasePath: null,
    };
    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider
          value={createWorkspaceStateValue({ closedWorkspaces: [closedWorkspace] })}
        >
          <SeedFilesystemDirectory />
          <OpenRepositoryModal open canClose onOpenChange={() => {}} />
        </WorkspaceStateContext.Provider>
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose repository folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));

    expect((await screen.findByLabelText<HTMLInputElement>("Workspace ID")).value).toBe("repo-2");
    unmount();
  });

  test("derives a free workspace ID when an incomplete removal holds the derived ID", async () => {
    const removal = {
      workspace: {
        workspaceId: "repo",
        workspaceName: "Removing repo",
        repoPath: "/other",
        isActive: false,
        hasConfig: true,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: null,
        effectiveWorktreeBasePath: null,
      },
      record: {
        version: 1 as const,
        operationId: "op-1",
        removeTaskWorktrees: false,
        phase: "task_store" as const,
        removedWorktrees: [],
        pendingWorktreePath: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        lastFailure: null,
      },
    };
    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider
          value={createWorkspaceStateValue({ incompleteRemovals: [removal] })}
        >
          <SeedFilesystemDirectory />
          <OpenRepositoryModal open canClose onOpenChange={() => {}} />
        </WorkspaceStateContext.Provider>
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose repository folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));

    expect((await screen.findByLabelText<HTMLInputElement>("Workspace ID")).value).toBe("repo-2");
    unmount();
  });

  test("locks modal dismissal and closed workspaces while a repository add is pending", async () => {
    const addWorkspaceResult = createDeferred<void>();
    const addWorkspace = mock(async () => addWorkspaceResult.promise);
    const onOpenChange = mock((_open: boolean) => {});
    const closedWorkspace = {
      workspaceId: "existing",
      workspaceName: "Existing",
      repoPath: "/other",
      isActive: false,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: "/worktrees",
      effectiveWorktreeBasePath: "/worktrees",
    };
    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider
          value={createWorkspaceStateValue({
            closedWorkspaces: [closedWorkspace],
            incompleteRemovals: [],
            addWorkspace,
          })}
        >
          <SeedFilesystemDirectory />
          <OpenRepositoryModal open canClose onOpenChange={onOpenChange} />
        </WorkspaceStateContext.Provider>
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose repository folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^open repository$/i }));

    expect(await screen.findByRole("button", { name: "Opening repository..." })).toBeTruthy();
    const closeButton = screen.getByRole("button", { name: "Close" });
    const closedWorkspaceButton = screen.getByRole("button", { name: /Existing/ });
    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new TypeError("Expected the close action to be a button.");
    }
    if (!(closedWorkspaceButton instanceof HTMLButtonElement)) {
      throw new TypeError("Expected the closed workspace action to be a button.");
    }
    expect(closeButton.disabled).toBe(true);
    expect(closedWorkspaceButton.disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();

    addWorkspaceResult.reject(new Error("Repository open failed"));

    await screen.findByText("Repository open failed");
    expect(screen.getByLabelText<HTMLInputElement>("Repository path").value).toBe("/repo");
    expect(closeButton.disabled).toBe(false);
    expect(closedWorkspaceButton.disabled).toBe(false);
    unmount();
  });

  test("reopens a closed workspace and closes the modal", async () => {
    const reopenWorkspace = mock(
      async (_input: { workspaceId: string; expectedRepoPath: string }): Promise<void> => {},
    );
    const onOpenChange = mock((_open: boolean) => {});
    const closedWorkspace = {
      workspaceId: "existing",
      workspaceName: "Existing",
      repoPath: "/other",
      isActive: false,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: "/worktrees",
      effectiveWorktreeBasePath: "/worktrees",
    };
    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider
          value={createWorkspaceStateValue({
            closedWorkspaces: [closedWorkspace],
            incompleteRemovals: [],
            reopenWorkspace,
          })}
        >
          <SeedFilesystemDirectory />
          <OpenRepositoryModal open canClose onOpenChange={onOpenChange} />
        </WorkspaceStateContext.Provider>
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Existing/ }));

    await waitFor(() => {
      expect(reopenWorkspace).toHaveBeenCalledWith({
        workspaceId: "existing",
        expectedRepoPath: "/other",
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    unmount();
  });

  test("reopens a closed workspace when the folder picker resolves a closed path", async () => {
    const reopenWorkspace = mock(
      async (_input: { workspaceId: string; expectedRepoPath: string }): Promise<void> => {},
    );
    const onOpenChange = mock((_open: boolean) => {});
    const closedWorkspace = {
      workspaceId: "existing",
      workspaceName: "Existing",
      repoPath: "/repo",
      isActive: false,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: "/worktrees",
      effectiveWorktreeBasePath: "/worktrees",
    };
    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider
          value={createWorkspaceStateValue({
            closedWorkspaces: [closedWorkspace],
            incompleteRemovals: [],
            resolveWorkspacePath: async () => ({ kind: "closed", workspace: closedWorkspace }),
            reopenWorkspace,
          })}
        >
          <SeedFilesystemDirectory />
          <OpenRepositoryModal open canClose onOpenChange={onOpenChange} />
        </WorkspaceStateContext.Provider>
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose repository folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));

    await waitFor(() => {
      expect(reopenWorkspace).toHaveBeenCalledWith({
        workspaceId: "existing",
        expectedRepoPath: "/repo",
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    unmount();
  });

  test("reports an open repository through the duplicate validation path", async () => {
    const openWorkspace = {
      workspaceId: "existing",
      workspaceName: "Existing",
      repoPath: "/repo",
      isActive: true,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: "/worktrees",
      effectiveWorktreeBasePath: "/worktrees",
    };
    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider
          value={createWorkspaceStateValue({
            workspaces: [openWorkspace],
            resolveWorkspacePath: async () => ({ kind: "open", workspace: openWorkspace }),
          })}
        >
          <SeedFilesystemDirectory />
          <OpenRepositoryModal open canClose onOpenChange={() => {}} />
        </WorkspaceStateContext.Provider>
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose repository folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));

    expect(await screen.findByText(/Repository is already configured as Existing/)).toBeTruthy();
    unmount();
  });

  test("keeps the folder picker open when the path has an incomplete removal", async () => {
    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider
          value={createWorkspaceStateValue({
            resolveWorkspacePath: async () => ({
              kind: "removing",
              removal: {
                workspace: {
                  workspaceId: "existing",
                  workspaceName: "Existing",
                  repoPath: "/repo",
                  isActive: false,
                  hasConfig: true,
                  configuredWorktreeBasePath: null,
                  defaultWorktreeBasePath: "/worktrees",
                  effectiveWorktreeBasePath: "/worktrees",
                },
                record: {
                  version: 1,
                  operationId: "op-1",
                  phase: "attachments",
                  removeTaskWorktrees: true,
                  removedWorktrees: [],
                  pendingWorktreePath: null,
                  startedAt: "2026-01-01T00:00:00.000Z",
                  lastFailure: null,
                },
              },
            }),
          })}
        >
          <SeedFilesystemDirectory />
          <OpenRepositoryModal open canClose onOpenChange={() => {}} />
        </WorkspaceStateContext.Provider>
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose repository folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));

    expect(await screen.findByText(/Workspace removal is incomplete/)).toBeTruthy();
    unmount();
  });

  test("shows the empty closed workspace message when none are closed", async () => {
    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider value={createWorkspaceStateValue()}>
          <SeedFilesystemDirectory />
          <OpenRepositoryModal open canClose onOpenChange={() => {}} />
        </WorkspaceStateContext.Provider>
      </QueryProvider>,
    );

    expect(await screen.findByText("No closed workspaces")).toBeTruthy();
    unmount();
  });

  test("closes the modal only after a pending repository add succeeds", async () => {
    const addWorkspaceResult = createDeferred<void>();
    const addWorkspace = mock(async () => addWorkspaceResult.promise);
    const onOpenChange = mock((_open: boolean) => {});
    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider value={createWorkspaceStateValue({ addWorkspace })}>
          <SeedFilesystemDirectory />
          <OpenRepositoryModal open canClose onOpenChange={onOpenChange} />
        </WorkspaceStateContext.Provider>
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose repository folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^open repository$/i }));

    expect(await screen.findByRole("button", { name: "Opening repository..." })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => addWorkspaceResult.resolve());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    unmount();
  });

  test("renders string host errors from repository add failures", async () => {
    addWorkspaceMock.mockClear();
    addWorkspaceMock.mockImplementation(() => {
      throw "bd not found in PATH";
    });

    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider value={createWorkspaceStateValue()}>
          <SeedFilesystemDirectory />
          {createElement(OpenRepositoryModal, {
            open: true,
            canClose: false,
            onOpenChange: () => {},
          })}
        </WorkspaceStateContext.Provider>
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose repository folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^open repository$/i }));

    await waitFor(() => {
      expect(addWorkspaceMock).toHaveBeenCalledWith({
        repoPath: "/repo",
        workspaceId: "repo",
        workspaceName: "repo",
      });
      expect(screen.getByText(/bd not found in path/i)).toBeTruthy();
    });

    unmount();
  });
});
