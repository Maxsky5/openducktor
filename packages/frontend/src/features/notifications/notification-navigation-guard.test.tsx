import { expect, mock, test } from "bun:test";
import type { NotificationNavigationTarget, WorkspaceRecord } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { useWorkspaceSessionPreview } from "@/pages/workspace-sessions/use-workspace-session-preview";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  NotificationContext,
  type NotificationContextValue,
} from "@/state/notifications/notification-context";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { NotificationNavigationRegistrar } from "./notification-navigation";

test("notification workspace selection keeps the draft on cancel and failure", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: { tasksList: async () => [createTaskCardFixture({ id: "task-1" })] },
    }),
  );
  const selectWorkspace = mock(async () => {});
  let navigateToNotification: ((target: NotificationNavigationTarget) => Promise<void>) | undefined;

  function PreviewGuard() {
    const [file, setFile] = useState<{ rootPath: string; relativePath: string } | null>({
      rootPath: "/first",
      relativePath: "draft.ts",
    });
    const { preview, onDiscard } = useWorkspaceSessionPreview(file, setFile);
    return (
      <>
        <output data-testid="draft">{preview.model.selectedFile?.relativePath ?? "none"}</output>
        <output data-testid="pending-discard">{String(preview.model.hasPendingDiscard)}</output>
        <button onClick={() => preview.model.onLeavePolicyChange("confirm")}>Edit draft</button>
        <button onClick={preview.model.onKeepEditing}>Keep editing</button>
        <button onClick={onDiscard}>Discard draft</button>
      </>
    );
  }

  const workspace = {
    workspaceId: "second",
    workspaceName: "Second",
    abbreviation: null,
    tileColor: null,
    repoPath: "/second",
    iconDataUrl: undefined,
    isActive: false,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: null,
    effectiveWorktreeBasePath: null,
  } satisfies WorkspaceRecord;
  const workspaceState = {
    activeWorkspace: null,
    workspaces: [workspace],
    branches: [],
    activeBranch: null,
    isSwitchingWorkspace: false,
    closedWorkspaces: [],
    incompleteRemovals: [],
    closeWorkspace: async () => {},
    removeWorkspace: async () => {},
    reopenWorkspace: async () => {},
    resolveWorkspacePath: async () => ({ kind: "new" as const }),
    isLoadingBranches: false,
    isSwitchingBranch: false,
    branchSyncDegraded: false,
    addWorkspace: async () => {},
    selectWorkspace,
    reorderWorkspaces: async () => {},
    refreshBranches: async () => {},
    switchBranch: async () => {},
    loadRepoSettings: async () => {
      throw new Error("Not used in this test");
    },
    saveRepoSettings: async () => {},
    loadSettingsSnapshot: async () => {
      throw new Error("Not used in this test");
    },
    detectGithubRepository: async () => null,
    saveGlobalGitConfig: async () => {},
    saveSettingsSnapshot: async () => {},
    saveAgentModelFavorites: async () => {
      throw new Error("Not used in this test");
    },
  } satisfies WorkspaceStateContextValue;
  const notificationContext = {
    deliveryFailure: null,
    getCapability: async () => ({
      platform: "unavailable" as const,
      supported: false,
      permission: "not_applicable" as const,
      canGuaranteeSilent: false,
      canOpenSystemSettings: false,
    }),
    openSystemSettings: async () => {},
    previewCue: async () => {},
    testInApp: async () => {},
    testOs: async () => ({ status: "shown" as const }),
    registerNavigator: (navigator: NonNullable<typeof navigateToNotification>) => {
      navigateToNotification = navigator;
      return () => (navigateToNotification = undefined);
    },
    sessionStartNotifications: {
      publishSessionStarted: () => {},
      publishSessionError: async () => true,
      reportFailure: () => {},
    },
    taskStreamSink: {
      onChange: async () => {},
      onSnapshot: async () => {},
      onSnapshotFailed: () => {},
      onFailure: () => {},
    },
  } satisfies NotificationContextValue;

  const queryClient = new QueryClient();
  const view = render(
    <MemoryRouter initialEntries={["/chats?session=first"]}>
      <QueryClientProvider client={queryClient}>
        <WorkspaceStateContext.Provider value={workspaceState}>
          <NotificationContext.Provider value={notificationContext}>
            <SettingsModalProvider>
              <WorkspacePreviewTransitionGuardProvider>
                <PreviewGuard />
                <NotificationNavigationRegistrar />
              </WorkspacePreviewTransitionGuardProvider>
            </SettingsModalProvider>
          </NotificationContext.Provider>
        </WorkspaceStateContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

  try {
    await waitFor(() => expect(navigateToNotification).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
    let navigation: Promise<void> | undefined;
    await act(async () => {
      navigation = navigateToNotification?.({
        type: "kanban_task",
        repoPath: "/second",
        taskId: "task-1",
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("pending-discard").textContent).toBe("true"));
    expect(selectWorkspace).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      await navigation;
    });
    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(screen.getByTestId("draft").textContent).toBe("draft.ts");

    selectWorkspace.mockImplementationOnce(async () => {
      throw new Error("Selection failed");
    });
    await act(async () => {
      navigation = navigateToNotification?.({
        type: "kanban_task",
        repoPath: "/second",
        taskId: "task-1",
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("pending-discard").textContent).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await act(async () => {
      await navigation;
    });
    expect(selectWorkspace).toHaveBeenCalledWith("second");
    expect(screen.getByTestId("draft").textContent).toBe("draft.ts");
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});
