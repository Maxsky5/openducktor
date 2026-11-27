import { ShortcutPreferencesProvider } from "@/features/shortcuts/shortcut-preferences-provider";
import { CommandPaletteRegistryProvider } from "@/features/command-palette/command-palette-registry";
import { type PropsWithChildren, type ReactElement, useCallback } from "react";
import { AgentSessionTranscriptDialogHost } from "@/components/features/agents/agent-chat/use-agent-session-transcript-dialog";
import { AppUpdatePrompt } from "@/components/features/app-updates/app-update-prompt";
import { DiagnosticsPanelProvider } from "@/components/features/diagnostics";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import {
  SettingsModalProvider,
  useSettingsModal,
} from "@/components/features/settings/settings-modal";
import { FeatureTourProvider } from "@/features/feature-tour/feature-tour-context";
import { FeatureTourDialogHost } from "@/features/feature-tour/feature-tour-dialog-host";
import { NotificationFailurePrompt } from "@/features/notifications/notification-failure-prompt";
import { NotificationNavigationRegistrar } from "@/features/notifications/notification-navigation";
import { TaskWorkflowActionsProvider } from "@/features/task-workflow/task-workflow-actions-provider";
import { ProcessesProvider } from "@/components/features/processes/processes-context";
import { ProcessesFloatingWindow } from "@/components/features/processes/processes-surfaces";
import { FloatingWindowLayer } from "@/components/ui/floating-window";
import { useNotificationContext } from "@/state/notifications/notification-context";
import { StartupNotifications } from "@/features/session-startup/session-startup-stack";
import { HostConnectionIndicator } from "./host-connection-indicator";

const reloadApplication = (): void => window.location.reload();

function NotificationFailurePromptHost(): ReactElement {
  const { deliveryFailure } = useNotificationContext();
  const { openSettings } = useSettingsModal();
  const openNotificationSettings = useCallback(
    () => openSettings({ deepLink: { kind: "global", section: "notifications" } }),
    [openSettings],
  );
  return (
    <NotificationFailurePrompt
      failure={deliveryFailure}
      onOpenSettings={openNotificationSettings}
      onReload={reloadApplication}
    />
  );
}

// Central composition layer for cross-page overlays that can be opened from anywhere in the app.
export function ApplicationOverlays({ children }: PropsWithChildren): ReactElement {
  return (
    <FloatingWindowLayer>
      <ShortcutPreferencesProvider>
        <CommandPaletteRegistryProvider>
          <FeatureTourProvider>
            <SettingsModalProvider>
              <HostConnectionIndicator onReload={reloadApplication} />
              <DiagnosticsPanelProvider>
                <NotificationFailurePromptHost />
                {/* The task sheet lives here, and it shows the ports of its task. */}
                <ProcessesProvider>
                  {/* The window stays across navigation, so it lives above the pages. */}
                  <ProcessesFloatingWindow />
                  <TaskWorkflowActionsProvider>
                    {/* One pool for the app, so page and workspace switches keep the warm diff workers. */}
                    <DiffWorkerProvider>
                      <AgentSessionTranscriptDialogHost>
                        <NotificationNavigationRegistrar />
                        {children}
                        <StartupNotifications />
                        <AppUpdatePrompt />
                      </AgentSessionTranscriptDialogHost>
                      {/*
                       * The tour opens from the shared Settings on every route, onboarding included. Its
                       * Create task needs the task workflow actions, and its pictures show diffs.
                       */}
                      <FeatureTourDialogHost />
                    </DiffWorkerProvider>
                  </TaskWorkflowActionsProvider>
                </ProcessesProvider>
              </DiagnosticsPanelProvider>
            </SettingsModalProvider>
          </FeatureTourProvider>
        </CommandPaletteRegistryProvider>
      </ShortcutPreferencesProvider>
    </FloatingWindowLayer>
  );
}
