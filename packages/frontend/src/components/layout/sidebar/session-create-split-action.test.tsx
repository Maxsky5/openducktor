import type { WorkspaceRef } from "@openducktor/contracts";
import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type RepositoryGitProviderContext,
  repoConfigSchema,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as settingsModal from "@/components/features/settings/settings-modal";
import { WorkspaceDialogsProvider } from "@/components/layout/workspace-dialogs";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { TaskWorkflowActionsContext } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { QueryProvider } from "@/test-utils/query-provider";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  ActiveWorkspaceContext,
  TaskControlContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { ChecksStateContext } from "@/state/app-state-contexts";
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
import type { ChecksStateContextValue } from "@/types/state-slices";
import { workspaceSessionQueryKeys } from "@openducktor/frontend-core/queries/workspace-sessions";
import { workspaceSessionRecord } from "@openducktor/frontend-core/test-support/workspace-session-fixtures";
import { issueImportListQueryOptions } from "@openducktor/frontend-core/tasks/issue-import/issue-import-model";
import { SessionCreateSplitAction } from "./session-create-split-action";

// Load the lazy dialogs before the test timeout starts.
await import("@/pages/kanban/issue-import-dialog");
await import("@/pages/workspace-sessions/workspace-session-history-dialog");

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
  taskStoreCheck = createObservedCheckFixture({ data: createTaskStoreCheckFixture() }),
}: {
  active?: typeof workspace | null;
  compact?: boolean;
  provider: RepositoryGitProviderContext;
  onCreateTask?: () => void;
  listArchived?: HostClient["workspaceSessionListArchived"];
  client?: Partial<HostClient>;
  refreshTaskData?: ({ repoPath }: WorkspaceRef) => Promise<void>;
  taskStoreCheck?: ChecksStateContextValue["taskStoreCheck"];
}) => {
  const connection = createTestClientConnection({
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
  });
  const tree = (activeWorkspace: typeof workspace | null) => (
    <MemoryRouter>
      <QueryProvider connection={connection}>
        <ActiveWorkspaceContext.Provider value={{ activeWorkspace, setActiveWorkspace: () => {} }}>
          <ChecksStateContext.Provider value={createChecksStateFixture({ taskStoreCheck })}>
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
                  <WorkspaceDialogsProvider>
                    <SessionCreateSplitAction compact={compact} />
                  </WorkspaceDialogsProvider>
                </WorkspacePreviewTransitionGuardProvider>
              </TaskControlContext.Provider>
            </TaskWorkflowActionsContext.Provider>
          </ChecksStateContext.Provider>
        </ActiveWorkspaceContext.Provider>
      </QueryProvider>
    </MemoryRouter>
  );
  const view = render(tree(active));
  return {
    ...view,
    connection,
    setActiveWorkspace: (next: typeof workspace) => view.rerender(tree(next)),
  };
};

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
        "New session",
        "Import tasks from GitHub Issues",
        "Archived sessions",
        "Import session from an external runtime",
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

  test("names a failed provider read and does not open Settings for it", async () => {
    const openSettings = mock(() => {});
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({ openSettings });
    try {
      renderSplitAction({
        provider: issueProvider(),
        client: {
          workspaceGetGitProviderContext: async () => {
            throw new Error("provider context unavailable");
          },
        },
      });

      fireEvent.click(screen.getByRole("button", { name: "More actions for openducktor" }));
      const item = await screen.findByRole("button", {
        name: /Import tasks from the Git provider/,
      });
      await waitFor(() =>
        expect(item.getAttribute("aria-description")).toBe(
          "Could not read the Git provider. provider context unavailable",
        ),
      );
      expect(item.hasAttribute("disabled")).toBe(true);
      fireEvent.click(item);

      expect(openSettings).not.toHaveBeenCalled();
    } finally {
      settings.mockRestore();
    }
  });

  test("opens archived chats for the workspace that was active when it opened", async () => {
    const record = workspaceSessionRecord("archive", {
      generatedTitle: "Archived in the first repository",
      archivedAt: 2_000,
    });
    const listArchived = mock(async (workspaceId: string) =>
      workspaceId === "alpha" ? [record] : [],
    );
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({
      openSettings: () => {},
    });
    try {
      const { connection, setActiveWorkspace } = renderSplitAction({
        provider: issueProvider(),
        listArchived,
      });
      connection.queryClient.setQueryData(workspaceSessionQueryKeys.list("alpha", true), [record]);
      const trigger = screen.getByRole("button", { name: "More actions for openducktor" });

      fireEvent.click(trigger);
      const archived = await screen.findByRole("button", { name: /Archived sessions/ });
      await act(async () => fireEvent.click(archived));

      const dialog = await screen.findByRole("dialog", { name: "Archived sessions" });
      expect(within(dialog).getByText("Archived in the first repository")).toBeTruthy();
      await waitFor(() => expect(listArchived).toHaveBeenCalledWith("alpha"));
      fireEvent.change(
        within(dialog).getByRole("searchbox", { name: "Filter archived sessions" }),
        {
          target: { value: "first repository" },
        },
      );
      await act(async () =>
        setActiveWorkspace(
          createWorkspaceRecordFixture({
            workspaceId: "beta",
            workspaceName: "Second repository",
            repoPath: "/repos/beta",
          }),
        ),
      );
      const openDialog = within(screen.getByRole("dialog", { name: "Archived sessions" }));
      expect(openDialog.getByDisplayValue("first repository")).toBeTruthy();
      expect(openDialog.getByText("Archived in the first repository")).toBeTruthy();
      expect(listArchived.mock.calls).toEqual([["alpha"]]);
      await act(async () => fireEvent.click(openDialog.getByRole("button", { name: "Close" })));
      await waitFor(
        () =>
          expect(document.activeElement === trigger, "Focus returns to the menu button").toBe(true),
        { timeout: 500 },
      );
    } finally {
      settings.mockRestore();
    }
  });

  test("imports provider tasks without a second board read", async () => {
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({
      openSettings: () => {},
    });
    const success = spyOn(toast, "success").mockImplementation(() => "toast-id");
    const error = spyOn(toast, "error").mockImplementation(() => "toast-id");
    const refreshTaskData = mock(async (_scope: WorkspaceRef) => {
      throw new Error("The task store is locked.");
    });
    try {
      const { connection } = renderSplitAction({
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

      // A cached list opens with no minimum loader. This test checks the import, not the loader.
      await connection.queryClient.prefetchQuery(
        issueImportListQueryOptions({
          workspaceId: workspace.workspaceId,
          repoPath: workspace.repoPath,
          provider: issueProvider(),
          search: "",
          cursor: undefined,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "More actions for openducktor" }));
      const importTasks = await screen.findByRole("button", {
        name: /Import tasks from GitHub Issues/,
      });
      await act(async () => fireEvent.click(importTasks));
      fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Review tasks" }));
      fireEvent.click(screen.getByRole("button", { name: "Import selected" }));

      await waitFor(() => expect(success).toHaveBeenCalledWith("1 Task created"));
      expect(refreshTaskData).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      success.mockRestore();
      settings.mockRestore();
    }
  });

  test("disables New task and Import after a failed task store check read", async () => {
    const settings = spyOn(settingsModal, "useSettingsModal").mockReturnValue({
      openSettings: () => {},
    });
    try {
      renderSplitAction({
        provider: issueProvider(),
        taskStoreCheck: createObservedCheckFixture({ error: "Host offline", failureKind: "error" }),
      });

      expect(
        screen.getByRole("button", { name: "New task in openducktor" }).hasAttribute("disabled"),
      ).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "More actions for openducktor" }));
      const menu = await screen.findByRole("dialog");
      const importTasks = await within(menu).findByRole("button", {
        name: "Import tasks from GitHub Issues",
      });
      expect(importTasks.hasAttribute("disabled")).toBe(true);
    } finally {
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
