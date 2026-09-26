import { afterEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES, type WorkspaceRecord } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { RuntimeDefinitionsContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type {
  WorkspaceSelectionOperationsInput,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { OpenRepositoryModal } from "./open-repository-modal";

const allowTransition = (apply: () => Promise<boolean>): void => {
  void apply();
};

const views = new Set<ReturnType<typeof render>>();
afterEach(() => {
  for (const view of views) view.unmount();
  views.clear();
});

const record = (input: WorkspaceSelectionOperationsInput): WorkspaceRecord => ({
  workspaceId: input.workspaceId,
  workspaceName: input.workspaceName,
  repoPath: input.repoPath,
  abbreviation: null,
  tileColor: null,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
});

const workspaceState = (
  overrides: Partial<WorkspaceStateContextValue> = {},
): WorkspaceStateContextValue => ({
  isSwitchingWorkspace: false,
  workspaces: [],
  closedWorkspaces: [],
  incompleteRemovals: [],
  activeWorkspace: null,
  branches: [],
  activeBranch: null,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  addWorkspace: async (input) => record(input),
  saveWorkspaceModelDefaults: async () => {},
  selectWorkspace: async () => {},
  closeWorkspace: async () => {},
  removeWorkspace: async () => {},
  reopenWorkspace: async () => {},
  resolveWorkspacePath: async () => ({ kind: "new" }),
  reorderWorkspaces: async () => {},
  refreshBranches: async () => {},
  switchBranch: async () => {},
  loadRepoSettings: async () => {
    throw new Error("Not used");
  },
  saveRepoSettings: async () => {},
  loadSettingsSnapshot: async () => createSettingsSnapshotFixture(),
  detectGithubRepository: async () => null,
  saveGlobalGitConfig: async () => {},
  saveSettingsSnapshot: async () => {},
  saveAgentModelFavorites: async () => createSettingsSnapshotFixture(),
  ...overrides,
});

const renderModal = ({
  state = workspaceState(),
  onOpenChange = () => {},
  canClose = true,
  open = true,
}: {
  state?: WorkspaceStateContextValue;
  onOpenChange?: (open: boolean) => void;
  canClose?: boolean;
  open?: boolean;
} = {}) => {
  const client = createQueryClient();
  client.setQueryData(filesystemQueryKeys.directory(), {
    currentPath: "/repo",
    currentPathIsGitRepo: true,
    parentPath: "/",
    homePath: "/repo",
    entries: [],
  });
  client.setQueryData(settingsSnapshotQueryOptions().queryKey, createSettingsSnapshotFixture());
  const tree = (isOpen: boolean) => (
    <QueryClientProvider client={client}>
      <RuntimeDefinitionsContext.Provider
        value={{
          runtimeDefinitions: [],
          availableRuntimeDefinitions: [],
          agentRuntimes: DEFAULT_AGENT_RUNTIMES,
          isLoadingRuntimeDefinitions: false,
          runtimeDefinitionsError: null,
          refreshRuntimeDefinitions: async () => [],
          isLoadingRuntimeSettings: false,
          runtimeSettingsError: null,
          hasRuntimeSettingsSnapshot: true,
          refreshRuntimeSettings: async () => {},
          loadRepoRuntimeCatalog: async () => ({}),
          loadRepoRuntimeFileSearch: async () => [],
        }}
      >
        <WorkspaceStateContext.Provider value={state}>
          <OpenRepositoryModal
            open={isOpen}
            canClose={canClose}
            onOpenChange={onOpenChange}
            requestTransition={allowTransition}
          />
        </WorkspaceStateContext.Provider>
      </RuntimeDefinitionsContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree(open));
  views.add(view);
  return { ...view, rerenderOpen: (nextOpen: boolean) => view.rerender(tree(nextOpen)) };
};

const chooseRepository = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Choose repository folder" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose This Folder" }));
  await screen.findByLabelText("Workspace ID");
};

describe("OpenRepositoryModal", () => {
  test("starts a fresh draft when reopened", async () => {
    const view = renderModal();
    await chooseRepository();
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Edited" } });
    view.rerenderOpen(false);
    view.rerenderOpen(true);
    expect(screen.getByRole("button", { name: "Choose repository folder" })).toBeTruthy();
    expect(screen.queryByLabelText("Workspace name")).toBeNull();
  });

  test("uses three stages and keeps Close left and Open repository right in the footer", async () => {
    const addWorkspace = mock(async (input: WorkspaceSelectionOperationsInput) => record(input));
    renderModal({ state: workspaceState({ addWorkspace }) });
    expect(screen.queryByText("Closed workspaces")).toBeNull();
    expect(screen.queryByText("No closed workspaces")).toBeNull();
    await chooseRepository();
    expect(screen.getByLabelText<HTMLInputElement>("Workspace ID").value).toBe("repo");
    expect(addWorkspace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue to models" }));
    expect(
      screen.getByText("Choose defaults for this workspace. You can leave every choice blank."),
    ).toBeTruthy();
    const footer = screen.getByRole("group", { name: "Repository actions" });
    expect(within(footer).getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.click(within(footer).getByRole("button", { name: "Open repository" }));
    await waitFor(() => expect(addWorkspace).toHaveBeenCalledTimes(1));
  });

  test("reopens a closed workspace from its folder without showing a closed list", async () => {
    const closed = {
      ...record({ workspaceId: "old", workspaceName: "Old", repoPath: "/repo" }),
      isActive: false,
    };
    const reopenWorkspace = mock(async () => {});
    const onOpenChange = mock((_open: boolean) => {});
    renderModal({
      state: workspaceState({
        closedWorkspaces: [closed],
        resolveWorkspacePath: async () => ({ kind: "closed", workspace: closed }),
        reopenWorkspace,
      }),
      onOpenChange,
    });
    expect(screen.queryByText("Closed workspaces")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose repository folder" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose This Folder" }));
    await waitFor(() =>
      expect(reopenWorkspace).toHaveBeenCalledWith({
        workspaceId: "old",
        expectedRepoPath: "/repo",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("keeps the picker open when workspace removal is incomplete", async () => {
    const closed = {
      ...record({ workspaceId: "old", workspaceName: "Old", repoPath: "/repo" }),
      isActive: false,
    };
    renderModal({
      state: workspaceState({
        resolveWorkspacePath: async () => ({
          kind: "removing",
          removal: {
            workspace: closed,
            record: {
              phase: "attachments",
              removeTaskWorktrees: true,
              pendingWorktreePath: null,
            },
          },
        }),
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose repository folder" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose This Folder" }));
    expect(await screen.findByText(/Workspace removal is incomplete/)).toBeTruthy();
  });
});
