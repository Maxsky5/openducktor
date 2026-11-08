import { describe, expect, spyOn, test } from "bun:test";
import { knownRuntimeKindValues, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  ActiveWorkspaceContext,
  RuntimeDefinitionsContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { autopilotSettingsQueryOptions } from "@openducktor/frontend-core/queries/autopilot";
import { runtimeExecutableQueryOptions } from "@openducktor/frontend-core/queries/runtime";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { HostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { TaskWorkflowActionsContext } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import {
  Children,
  type ElementType,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { MemoryRouter } from "react-router";
import * as transcriptDialog from "@/components/features/agents/agent-chat/use-agent-session-transcript-dialog";
import { AgentSessionTranscriptDialogHost } from "@/components/features/agents/agent-chat/use-agent-session-transcript-dialog";
import * as appUpdates from "@/components/features/app-updates/app-update-prompt";
import { useSettingsModal } from "@/components/features/settings/settings-modal";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import * as diffWorkers from "@/contexts/DiffWorkerProvider";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import { FeatureTourProvider } from "@/features/feature-tour/feature-tour-context";
import { FeatureTourDialogHost } from "@/features/feature-tour/feature-tour-dialog-host";
import * as taskWorkflow from "@/features/task-workflow/task-workflow-actions-provider";
import { TaskWorkflowActionsProvider } from "@/features/task-workflow/task-workflow-actions-provider";
import { ChecksStateContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  NotificationContext,
  type NotificationContextValue,
} from "@/state/notifications/notification-context";
import { DiagnosticsAutoOpenProvider } from "@/state/providers/diagnostics-auto-open-provider";
import { QueryProvider } from "@/test-utils/query-provider";
import { restoreAfterTestBody } from "@/test-utils/restore-after-test-body";
import {
  createChecksStateFixture,
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
  createTaskWorkflowActionsFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { ApplicationOverlays } from "./application-overlays";

// The tour host loads the dialog lazily. Load it here, so no test pays for the first load.
await import("@/features/feature-tour/feature-tour-dialog");

function findElementByType(node: ReactNode, type: ElementType): ReactNode {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) {
      continue;
    }
    if (child.type === type) {
      return child;
    }
    const match = findElementByType(child.props.children, type);
    if (match) {
      return match;
    }
  }
  return null;
}

function containsElementByType(node: ReactNode, type: ElementType): boolean {
  return findElementByType(node, type) !== null;
}

function OpenSettingsButton(): ReactElement {
  const { openSettings } = useSettingsModal();
  return (
    <button type="button" onClick={() => openSettings()}>
      Open settings
    </button>
  );
}

/** Renders the overlays of the onboarding route: no workspace is active, and no app shell shows. */
const renderOnboardingOverlays = () => {
  const snapshot = createSettingsSnapshotFixture();
  const connection = createTestClientConnection({
    client: { workspaceGetSettingsSnapshot: async () => structuredClone(snapshot) },
  });
  const { queryClient } = connection;
  queryClient.setQueryData(settingsSnapshotQueryOptions().queryKey, snapshot);
  queryClient.setQueryData(autopilotSettingsQueryOptions().queryKey, snapshot.autopilot);
  for (const kind of knownRuntimeKindValues) {
    const path = snapshot.agentRuntimes[kind].executablePath;
    queryClient.setQueryData(runtimeExecutableQueryOptions(kind, path).queryKey, {
      kind,
      path,
      ok: true,
      version: "1.0.0",
      error: null,
    });
  }
  const workspaceState = createWorkspaceStateFixture({ activeWorkspace: null, workspaces: [] });
  // These overlays need the full app state, and the test checks only Settings and the tour.
  const spies = [
    spyOn(taskWorkflow, "TaskWorkflowActionsProvider").mockImplementation(({ children }) => (
      <TaskWorkflowActionsContext.Provider value={createTaskWorkflowActionsFixture()}>
        {children}
      </TaskWorkflowActionsContext.Provider>
    )),
    spyOn(transcriptDialog, "AgentSessionTranscriptDialogHost").mockImplementation(
      ({ children }) => <>{children}</>,
    ),
    // Bun does not bundle the browser worker URL of the syntax library.
    spyOn(diffWorkers, "DiffWorkerProvider").mockImplementation(({ children }) => <>{children}</>),
    spyOn(appUpdates, "AppUpdatePrompt").mockImplementation(() => null),
  ];
  const restoreSpies = restoreAfterTestBody(() => {
    for (const spy of spies) spy.mockRestore();
  });
  const view = render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <QueryProvider connection={connection}>
        <ThemeProvider>
          <ActiveWorkspaceContext.Provider
            value={{ activeWorkspace: null, setActiveWorkspace: () => {} }}
          >
            <WorkspaceStateContext.Provider value={workspaceState}>
              <ChecksStateContext.Provider value={createChecksStateFixture()}>
                <RuntimeDefinitionsContext.Provider
                  value={{
                    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
                    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
                    agentRuntimes: snapshot.agentRuntimes,
                    isLoadingRuntimeDefinitions: false,
                    runtimeDefinitionsError: null,
                    isLoadingRuntimeSettings: false,
                    runtimeSettingsError: null,
                    hasRuntimeSettingsSnapshot: true,
                    refreshRuntimeSettings: async () => {},
                    refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
                    loadRepoRuntimeCatalog: async () => {
                      throw new Error("Not used in this test");
                    },
                    loadRepoRuntimeFileSearch: async () => [],
                  }}
                >
                  <HostRuntimeStatusContext.Provider value={createHostRuntimeStatusContextValue()}>
                    <NotificationContext.Provider value={notificationContextValue}>
                      <DiagnosticsAutoOpenProvider>
                        <WorkspacePreviewTransitionGuardProvider>
                          <ApplicationOverlays>
                            <OpenSettingsButton />
                          </ApplicationOverlays>
                        </WorkspacePreviewTransitionGuardProvider>
                      </DiagnosticsAutoOpenProvider>
                    </NotificationContext.Provider>
                  </HostRuntimeStatusContext.Provider>
                </RuntimeDefinitionsContext.Provider>
              </ChecksStateContext.Provider>
            </WorkspaceStateContext.Provider>
          </ActiveWorkspaceContext.Provider>
        </ThemeProvider>
      </QueryProvider>
    </MemoryRouter>,
  );
  return {
    view,
    unmount: () => {
      try {
        view.unmount();
        queryClient.clear();
      } finally {
        restoreSpies();
      }
    },
  };
};

const notificationContextValue: NotificationContextValue = {
  deliveryFailure: null,
  getCapability: async () => ({
    platform: "unavailable" as const,
    supported: false,
    permission: "not_applicable" as const,
    canGuaranteeSilent: false,
    canOpenSystemSettings: false,
  }),
  requestPermission: async () => {
    throw new Error("Unexpected notification permission request.");
  },
  openSystemSettings: async () => {},
  previewCue: async () => {},
  testInApp: async () => {},
  testOs: async () => ({ status: "shown" as const }),
  registerNavigator: () => () => {},
  sessionStartNotifications: {
    publishSessionStarted: () => {},
    publishSessionError: async () => true,
    markInAppFeedbackHandled: () => {},
    reportFailure: () => {},
  },
};

describe("ApplicationOverlays", () => {
  test("mounts the transcript dialog host inside the task workflow actions provider", () => {
    const overlays = ApplicationOverlays({ children: null });
    const provider = findElementByType(overlays, TaskWorkflowActionsProvider);
    const dialogHost = findElementByType(overlays, AgentSessionTranscriptDialogHost);

    expect(provider).not.toBeNull();
    expect(dialogHost).not.toBeNull();
    expect(containsElementByType(provider, AgentSessionTranscriptDialogHost)).toBe(true);
    expect(containsElementByType(dialogHost, TaskWorkflowActionsProvider)).toBe(false);
  });

  test("mounts the feature tour around all overlays", () => {
    const overlays = ApplicationOverlays({ children: null });

    expect(isValidElement(overlays) && overlays.type === FeatureTourProvider).toBe(true);
  });

  test("keeps the app and the tour in one diff worker pool", () => {
    const overlays = ApplicationOverlays({ children: <main>App</main> });
    const workers = findElementByType(overlays, DiffWorkerProvider);

    expect(containsElementByType(workers, "main")).toBe(true);
    expect(containsElementByType(workers, FeatureTourDialogHost)).toBe(true);
  });

  test("opens the tour from the shared Settings on onboarding, with the focus on Next", async () => {
    const overlays = renderOnboardingOverlays();
    try {
      const page = within(document.body);
      await act(async () => {
        fireEvent.click(page.getByRole("button", { name: "Open settings" }));
      });
      const settings = within(page.getByRole("dialog"));
      const general = settings.getByRole("button", { name: "General" });
      await waitFor(() => expect(general.hasAttribute("disabled")).toBe(false), { timeout: 800 });
      fireEvent.click(general);
      const showTour = settings.getByRole("button", { name: "Show tour" });
      await act(async () => {
        fireEvent.click(showTour);
      });
      const tour = await waitFor(
        () => {
          const dialogs = page.getAllByRole("dialog");
          expect(dialogs).toHaveLength(1);
          return within(dialogs[0]!);
        },
        { timeout: 500 },
      );
      expect(tour.getByText("1 of 8")).toBeDefined();
      expect(document.activeElement).toBe(tour.getByRole("button", { name: "Next" }));
    } finally {
      overlays.unmount();
    }
  });
});
