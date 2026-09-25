import { expect, mock, test } from "bun:test";
import type { NotificationNavigationTarget, WorkspaceRecord } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import {
  useWorkspacePreviewTransitionGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  NotificationContext,
  type NotificationContextValue,
} from "@/state/notifications/notification-context";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { NotificationNavigationRegistrar } from "./notification-navigation";

test("a notification cannot switch workspaces after the preview guard cancels", async () => {
  const selectWorkspace = mock(async () => {});
  let navigateToNotification: ((target: NotificationNavigationTarget) => Promise<void>) | undefined;
  let cancelTransition: (() => void) | undefined;

  function PreviewGuard() {
    const { register } = useWorkspacePreviewTransitionGuard();
    useEffect(() => register((_apply, cancel) => (cancelTransition = cancel)), [register]);
    return null;
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
    let navigation: Promise<void> | undefined;
    await act(async () => {
      navigation = navigateToNotification?.({
        type: "kanban_task",
        repoPath: "/second",
        taskId: "task-1",
      });
      await Promise.resolve();
    });
    expect(cancelTransition).toBeDefined();
    expect(selectWorkspace).not.toHaveBeenCalled();

    await act(async () => {
      cancelTransition?.();
      await navigation;
    });
    expect(selectWorkspace).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    queryClient.clear();
  }
});
