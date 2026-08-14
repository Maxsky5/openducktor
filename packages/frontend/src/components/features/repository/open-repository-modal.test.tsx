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
  test("locks modal dismissal and recent workspaces while a repository add is pending", async () => {
    const addWorkspaceResult = createDeferred<void>();
    const addWorkspace = mock(async () => addWorkspaceResult.promise);
    const onOpenChange = mock((_open: boolean) => {});
    const recentWorkspace = {
      workspaceId: "existing",
      workspaceName: "Existing",
      repoPath: "/other",
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
            activeWorkspace: recentWorkspace,
            workspaces: [recentWorkspace],
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
    const recentButton = screen.getByRole("button", { name: /Existing/ });
    expect((closeButton as HTMLButtonElement).disabled).toBe(true);
    expect((recentButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();

    addWorkspaceResult.reject(new Error("Repository open failed"));

    await screen.findByText("Repository open failed");
    expect((screen.getByLabelText("Repository path") as HTMLInputElement).value).toBe("/repo");
    expect((closeButton as HTMLButtonElement).disabled).toBe(false);
    expect((recentButton as HTMLButtonElement).disabled).toBe(false);
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
