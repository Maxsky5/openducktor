import { afterEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES, type WorkspaceRecord } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import {
  useWorkspacePreviewTransitionGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import { createQueryClient } from "@/lib/query-client";
import { useWorkspaceSessionPreview } from "@/pages/workspace-sessions/use-workspace-session-preview";
import { RuntimeDefinitionsContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
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

const runtimeDefinitionsValue = {
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
};

const renderModal = ({
  state = workspaceState(),
  onOpenChange = () => {},
  requestTransition = allowTransition,
  canClose = true,
  open = true,
}: {
  state?: WorkspaceStateContextValue;
  onOpenChange?: (open: boolean) => void;
  requestTransition?: Parameters<typeof OpenRepositoryModal>[0]["requestTransition"];
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
      <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsValue}>
        <WorkspaceStateContext.Provider value={state}>
          <OpenRepositoryModal
            open={isOpen}
            canClose={canClose}
            onOpenChange={onOpenChange}
            requestTransition={requestTransition}
          />
        </WorkspaceStateContext.Provider>
      </RuntimeDefinitionsContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree(open));
  views.add(view);
  return { ...view, rerenderOpen: (nextOpen: boolean) => view.rerender(tree(nextOpen)) };
};

function DirtyPreview() {
  const [file, setFile] = useState<TaskExecutionSelectedFile | null>({
    rootPath: "/repo",
    relativePath: "draft.ts",
  });
  const { preview, onDiscard } = useWorkspaceSessionPreview(file, setFile, false);
  return (
    <>
      <output data-testid="draft">{preview.model.selectedFile?.relativePath ?? "none"}</output>
      <output data-testid="pending-discard">{String(preview.model.hasPendingDiscard)}</output>
      <button type="button" onClick={() => preview.model.onLeavePolicyChange("confirm")}>
        Edit draft
      </button>
      <button type="button" onClick={onDiscard}>
        Discard draft
      </button>
    </>
  );
}

function GuardedModal() {
  const { run } = useWorkspacePreviewTransitionGuard();
  return <OpenRepositoryModal open canClose onOpenChange={() => {}} requestTransition={run} />;
}

const renderGuardedModal = (state: WorkspaceStateContextValue) => {
  const client = createQueryClient();
  client.setQueryData(filesystemQueryKeys.directory(), {
    currentPath: "/repo",
    currentPathIsGitRepo: true,
    parentPath: "/",
    homePath: "/repo",
    entries: [],
  });
  client.setQueryData(settingsSnapshotQueryOptions().queryKey, createSettingsSnapshotFixture());
  const view = render(
    <QueryClientProvider client={client}>
      <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsValue}>
        <WorkspaceStateContext.Provider value={state}>
          <WorkspacePreviewTransitionGuardProvider>
            <GuardedModal />
            <DirtyPreview />
          </WorkspacePreviewTransitionGuardProvider>
        </WorkspaceStateContext.Provider>
      </RuntimeDefinitionsContext.Provider>
    </QueryClientProvider>,
  );
  views.add(view);
  return view;
};

const chooseRepository = async () => {
  if (screen.queryByRole("heading", { name: "Open a new workspace" })) {
    fireEvent.click(screen.getByRole("button", { name: "Choose repository folder" }));
  }
  fireEvent.click(await screen.findByRole("button", { name: "Choose This Folder" }));
  await screen.findByLabelText("Workspace ID");
};

describe("OpenRepositoryModal", () => {
  test("opens the folder picker directly when no workspaces are closed", async () => {
    renderModal();

    expect(await screen.findByRole("dialog", { name: "Open Repository" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Choose This Folder" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Open a new workspace" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Reopen a workspace" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Choose a repository" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to workspaces" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose repository folder" }));
    expect(await screen.findByRole("button", { name: "Choose This Folder" })).toBeTruthy();
  });

  test.each(["add", "closed row", "closed folder"] as const)(
    "keeps the dirty draft when %s fails",
    async (path) => {
      const action = createDeferred<void>();
      const addWorkspace = mock(async (input: WorkspaceSelectionOperationsInput) => {
        await action.promise;
        return record(input);
      });
      const reopenWorkspace = mock(() => action.promise);
      const closed = {
        ...record({ workspaceId: "closed", workspaceName: "Closed", repoPath: "/repo" }),
        isActive: false,
      };
      renderGuardedModal(
        workspaceState({
          addWorkspace,
          reopenWorkspace,
          closedWorkspaces: path === "add" ? [] : [closed],
          resolveWorkspacePath: async () =>
            path === "closed folder" ? { kind: "closed", workspace: closed } : { kind: "new" },
        }),
      );

      fireEvent.click(screen.getByText("Edit draft"));
      if (path === "closed row") {
        fireEvent.click(screen.getByRole("button", { name: /Closed.*\/repo/ }));
      } else {
        if (path === "closed folder") {
          fireEvent.click(screen.getByRole("button", { name: "Choose repository folder" }));
        }
        fireEvent.click(await screen.findByRole("button", { name: "Choose This Folder" }));
        if (path === "add") {
          await screen.findByLabelText("Workspace ID");
          fireEvent.click(screen.getByRole("button", { name: "Continue to models" }));
          fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
        }
      }
      await waitFor(() => expect(screen.getByTestId("pending-discard").textContent).toBe("true"));
      fireEvent.click(screen.getByText("Discard draft"));
      await waitFor(() =>
        expect(path === "add" ? addWorkspace : reopenWorkspace).toHaveBeenCalledTimes(1),
      );
      expect(screen.getByTestId("draft").textContent).toBe("draft.ts");
      await act(async () => action.reject(new Error("Workspace failed")));
      expect(await screen.findByText("Workspace failed")).toBeTruthy();
      expect(screen.getByTestId("draft").textContent).toBe("draft.ts");
    },
  );

  test("starts a fresh draft when reopened", async () => {
    const view = renderModal();
    await chooseRepository();
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Edited" } });
    view.rerenderOpen(false);
    view.rerenderOpen(true);
    expect(await screen.findByRole("button", { name: "Choose This Folder" })).toBeTruthy();
    expect(screen.queryByLabelText("Workspace name")).toBeNull();
  });

  test("uses three stages and keeps Close left and Open repository right in the footer", async () => {
    const addWorkspace = mock(async (input: WorkspaceSelectionOperationsInput) => record(input));
    const closed = {
      ...record({ workspaceId: "old", workspaceName: "Old", repoPath: "/old" }),
      isActive: false,
    };
    renderModal({ state: workspaceState({ addWorkspace, closedWorkspaces: [closed] }) });
    expect(screen.getByText("Open a new workspace")).toBeTruthy();
    expect(screen.getByText("Reopen a workspace")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Old.*\/old/ })).toBeTruthy();
    await chooseRepository();
    expect(screen.queryByText("Reopen a workspace")).toBeNull();
    expect(screen.queryByRole("button", { name: /Old.*\/old/ })).toBeNull();
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

  test("keeps model defaults in a scrollable body", async () => {
    renderModal();
    await chooseRepository();
    fireEvent.click(screen.getByRole("button", { name: "Continue to models" }));

    const dialog = screen.getByRole("dialog", { name: "Open a repository" });
    const roleDefaults = screen.getByText("Role defaults");
    const body = Array.from(dialog.children).find((child) => child.contains(roleDefaults));
    expect(body?.classList.contains("overflow-y-auto")).toBe(true);
  });

  test("reserves workspace IDs used by closed and incomplete-removal workspaces", async () => {
    const closed = {
      ...record({ workspaceId: "repo", workspaceName: "Closed", repoPath: "/closed" }),
      isActive: false,
    };
    const removing = {
      ...record({ workspaceId: "repo-2", workspaceName: "Removing", repoPath: "/removing" }),
      isActive: false,
    };
    renderModal({
      state: workspaceState({
        closedWorkspaces: [closed],
        incompleteRemovals: [
          {
            workspace: removing,
            record: { phase: "attachments", removeTaskWorktrees: false, pendingWorktreePath: null },
          },
        ],
      }),
    });
    await chooseRepository();
    expect(screen.getByLabelText<HTMLInputElement>("Workspace ID").value).toBe("repo-3");
  });

  test("reopens a closed workspace directly from the entry screen", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Old.*\/repo/ }));
    await waitFor(() =>
      expect(reopenWorkspace).toHaveBeenCalledWith({
        workspaceId: "old",
        expectedRepoPath: "/repo",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("waits for the preview decision before reopening a closed workspace", async () => {
    const closed = {
      ...record({ workspaceId: "old", workspaceName: "Old", repoPath: "/repo" }),
      isActive: false,
    };
    const reopenWorkspace = mock(async () => {});
    const onOpenChange = mock((_open: boolean) => {});
    const transitions: Array<{ apply: () => Promise<boolean>; cancel: () => void }> = [];
    renderModal({
      state: workspaceState({ closedWorkspaces: [closed], reopenWorkspace }),
      onOpenChange,
      requestTransition: (apply, cancel) => {
        transitions.push({ apply, cancel: cancel ?? (() => {}) });
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Old.*\/repo/ }));
    expect(transitions).toHaveLength(1);
    expect(reopenWorkspace).not.toHaveBeenCalled();
    await act(async () => transitions[0]?.cancel());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: /Old.*\/repo/ }));
    expect(transitions).toHaveLength(2);
    await act(async () => {
      await transitions[1]?.apply();
    });
    expect(reopenWorkspace).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("keeps closed workspaces on the entry screen while a folder can still reopen one", async () => {
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
    expect(screen.getByText("Reopen a workspace")).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "Choose This Folder" }));
    expect(await screen.findByText(/Workspace removal is incomplete/)).toBeTruthy();
  });
});
