import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode, useEffect } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { WorkspaceStateContextValue } from "@/types/state-slices";

enableReactActEnvironment();

const omitDialogDomProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const {
    closeButton: _closeButton,
    onEscapeKeyDown: _onEscapeKeyDown,
    onPointerDownOutside: _onPointerDownOutside,
    onOpenChange: _onOpenChange,
    ...domProps
  } = props;

  return domProps;
};

const addWorkspaceMock = mock(
  async (_input: {
    workspaceId: string;
    workspaceName: string;
    repoPath: string;
  }): Promise<void> => {},
);
const selectWorkspaceMock = mock(async (_repoPath: string): Promise<void> => {});
const actualButtonModule = await import("@/components/ui/button");
const actualDialogModule = await import("@/components/ui/dialog");

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
  let OpenRepositoryModal: (props: {
    open: boolean;
    canClose: boolean;
    onOpenChange: () => void;
  }) => ReactNode;

  beforeEach(async () => {
    mock.module("@/components/ui/button", () => ({
      Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("button", { type: "button", ...props }, children),
    }));

    mock.module("@/components/ui/dialog", () => ({
      Dialog: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogBody: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogDescription: ({
        children,
        ...props
      }: {
        children: ReactNode;
        [key: string]: unknown;
      }) => createElement("p", omitDialogDomProps(props), children),
      DialogFooter: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("h2", omitDialogDomProps(props), children),
    }));

    ({ OpenRepositoryModal } = await import("./open-repository-modal"));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/components/ui/button", async () => actualButtonModule],
      ["@/components/ui/dialog", async () => actualDialogModule],
    ]);
  });

  test("renders string host errors from repository add failures", async () => {
    addWorkspaceMock.mockClear();
    addWorkspaceMock.mockImplementation(() => {
      throw "bd not found in PATH";
    });

    const { container, unmount } = render(
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

    const primaryButton = container.querySelector("button");
    if (!primaryButton) {
      throw new Error("Primary button not found");
    }

    fireEvent.click(primaryButton);
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /^open repository$/i }));

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
