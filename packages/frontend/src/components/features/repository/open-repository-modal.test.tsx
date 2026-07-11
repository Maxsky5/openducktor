import { describe, expect, mock, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode, useEffect } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
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

const createWorkspaceStateValue = (): WorkspaceStateContextValue => ({
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
