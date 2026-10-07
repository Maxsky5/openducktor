import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type RepositoryGitProviderContext,
  repoConfigSchema,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as settingsModal from "@/components/features/settings/settings-modal";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { TaskWorkflowActionsContext } from "@/features/task-workflow/task-workflow-actions-context";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import {
  ActiveWorkspaceContext,
  ChecksStateContext,
  TaskControlContext,
} from "@/state/app-state-contexts";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  createChecksStateFixture,
  createGitProviderContextFixture,
  createObservedCheckFixture,
  createTaskStoreCheckFixture,
  createTaskWorkflowActionsFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import { SessionCreateSplitAction } from "./session-create-split-action";

const workspace = createWorkspaceRecordFixture({
  workspaceId: "alpha",
  workspaceName: "openducktor",
  repoPath: "/repos/alpha",
});

const issueProvider = (): NonNullable<RepositoryGitProviderContext> => ({
  ...createGitProviderContextFixture(),
  descriptor: GITHUB_PROVIDER_DESCRIPTOR,
});

const renderSplitAction = ({
  active = workspace,
  compact = false,
  provider,
  onCreateTask = () => {},
  listArchived = async () => [],
  client = {},
  refreshTaskData = async () => {},
}: {
  active?: typeof workspace | null;
  compact?: boolean;
  provider: RepositoryGitProviderContext;
  onCreateTask?: () => void;
  listArchived?: (workspaceId: string) => Promise<never[]>;
  client?: Partial<HostClient>;
  refreshTaskData?: (repoPath: string) => Promise<void>;
}) => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceGetGitProviderContext: async () => provider,
        workspaceGetRepoConfig: async () =>
          repoConfigSchema.parse({
            workspaceId: workspace.workspaceId,
            workspaceName: workspace.workspaceName,
            repoPath: workspace.repoPath,
          }),
        workspaceSessionListArchived: listArchived,
        ...client,
      },
    }),
  );
  return render(
    <MemoryRouter>
      <QueryProvider useIsolatedClient>
        <ActiveWorkspaceContext.Provider
          value={{ activeWorkspace: active, setActiveWorkspace: () => {} }}
        >
          <ChecksStateContext.Provider
            value={createChecksStateFixture({
              taskStoreCheck: createObservedCheckFixture({ data: createTaskStoreCheckFixture() }),
            })}
          >
            <TaskWorkflowActionsContext.Provider
              value={createTaskWorkflowActionsFixture({ onCreateTask })}
            >
              <TaskControlContext.Provider
                value={{
                  refreshTaskData,
                  loadWorkspaceTasks: async () => {},
                  refreshTasksWithOptions: async () => {},
                  clearTaskData: () => {},
                  setIsLoadingTasks: () => {},
                }}
              >
                <WorkspacePreviewTransitionGuardProvider>
                  <SessionCreateSplitAction compact={compact} />
                </WorkspacePreviewTransitionGuardProvider>
              </TaskControlContext.Provider>
            </TaskWorkflowActionsContext.Provider>
          </ChecksStateContext.Provider>
        </ActiveWorkspaceContext.Provider>
      </QueryProvider>
    </MemoryRouter>,
  );
};

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

describe("SessionCreateSplitAction", () => {
  test("uses one compact button and creates a task only from its menu option", async () => {
    const onCreateTask = mock(() => {});
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({
      openSettings: () => {},
    });
    try {
      renderSplitAction({ provider: issueProvider(), onCreateTask, compact: true });
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1);

      fireEvent.click(buttons[0]!);
      expect(onCreateTask).not.toHaveBeenCalled();
      const menu = await screen.findByRole("dialog");
      fireEvent.click(within(menu).getByRole("button", { name: "New task" }));

      expect(onCreateTask).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    } finally {
      settings.mockRestore();
    }
  });

  test("starts a new task from the main action for the active workspace", () => {
    const onCreateTask = mock(() => {});
    const openSettings = mock(() => {});
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({ openSettings });
    try {
      renderSplitAction({ provider: issueProvider(), onCreateTask });

      fireEvent.click(screen.getByRole("button", { name: "New task in openducktor" }));

      expect(onCreateTask).toHaveBeenCalledTimes(1);
    } finally {
      settings.mockRestore();
    }
  });

  test("offers the chat and import actions for the active workspace", async () => {
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({
      openSettings: () => {},
    });
    try {
      renderSplitAction({ provider: issueProvider() });

      fireEvent.click(screen.getByRole("button", { name: "More actions for openducktor" }));

      const menu = await screen.findByRole("dialog");
      await within(menu).findByText("Import tasks from GitHub Issues");
      expect(
        within(menu)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual([
        "New chat",
        "Import tasks from GitHub Issues",
        "Archived chats",
        "Import chat from an external runtime",
      ]);
    } finally {
      settings.mockRestore();
    }
  });

  test("names the missing provider setup and opens Settings for it", async () => {
    const openSettings = mock(() => {});
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({ openSettings });
    try {
      renderSplitAction({ provider: createGitProviderContextFixture({ enabled: false }) });

      fireEvent.click(screen.getByRole("button", { name: "More actions for openducktor" }));
      const item = await screen.findByRole("button", {
        name: /Import tasks from the Git provider/,
      });
      await waitFor(() =>
        expect(item.getAttribute("aria-description")).toBe(
          "Set up a Git provider with issue access in Settings.",
        ),
      );
      fireEvent.click(item);

      expect(openSettings).toHaveBeenCalledTimes(1);
    } finally {
      settings.mockRestore();
    }
  });

  test("opens archived chats for the workspace that was active when it opened", async () => {
    const listArchived = mock(async (_workspaceId: string) => []);
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({
      openSettings: () => {},
    });
    try {
      renderSplitAction({ provider: issueProvider(), listArchived });

      fireEvent.click(screen.getByRole("button", { name: "More actions for openducktor" }));
      fireEvent.click(await screen.findByRole("button", { name: /Archived chats/ }));

      await screen.findByRole("heading", { name: "Archived chats" });
      await waitFor(() => expect(listArchived).toHaveBeenCalledWith("alpha"));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(
          document.activeElement ===
            screen.getByRole("button", { name: "More actions for openducktor" }),
        ).toBe(true),
      );
    } finally {
      settings.mockRestore();
    }
  });

  test("reports a task list refresh failure after a provider import", async () => {
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({
      openSettings: () => {},
    });
    const success = spyOn(toast, "success").mockImplementation(() => "toast-id");
    const error = spyOn(toast, "error").mockImplementation(() => "toast-id");
    const refreshTaskData = mock(async (_repoPath: string) => {
      throw new Error("The task store is locked.");
    });
    try {
      renderSplitAction({
        provider: issueProvider(),
        client: {
          issueItemsList: async () => ({
            items: [
              {
                providerId: "github",
                scope: "github.com/example/repo",
                sourceId: "1",
                number: "1",
                url: "https://github.com/example/repo/issues/1",
                title: "Issue 1",
                description: "Body 1",
                creator: "octocat",
                updatedAt: "2026-09-23T00:00:00Z",
                tags: [],
                revision: "1",
              },
            ],
            nextCursor: undefined,
            searchSupported: true,
            incompleteResults: false,
          }),
          issueItemsImport: async () => ({
            results: [{ sourceId: "1", outcome: "created", taskId: "TASK-1" }],
          }),
        },
        refreshTaskData,
      });

      fireEvent.click(screen.getByRole("button", { name: "More actions for openducktor" }));
      fireEvent.click(
        await screen.findByRole("button", { name: /Import tasks from GitHub Issues/ }),
      );
      fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
      fireEvent.click(screen.getByRole("button", { name: "Import selected" }));

      await waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          "Tasks were imported, but the task list did not refresh.",
          { description: "The task store is locked. Refresh the Kanban board to see them." },
        ),
      );
      expect(refreshTaskData).toHaveBeenCalledWith("/repos/alpha");
    } finally {
      error.mockRestore();
      success.mockRestore();
      settings.mockRestore();
    }
  });

  test("disables workspace actions when no workspace is selected", () => {
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({
      openSettings: () => {},
    });
    try {
      renderSplitAction({ provider: issueProvider(), active: null });

      expect(screen.getByRole("button", { name: "New task" }).hasAttribute("disabled")).toBe(true);
      expect(
        screen.getByRole("button", { name: "More create actions" }).hasAttribute("disabled"),
      ).toBe(true);
    } finally {
      settings.mockRestore();
    }
  });
});
