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
import {
  NotificationAttentionFocus,
  NotificationNavigationRegistrar,
} from "@/features/notifications/notification-navigation";
import { TaskWorkflowActionsProvider } from "@/features/task-workflow/task-workflow-actions-provider";
import { useNotificationContext } from "@/state/notifications/notification-context";
import { StartupNotifications } from "@/features/session-startup/session-startup-stack";

function NotificationFailurePromptHost(): ReactElement {
  const { deliveryFailure } = useNotificationContext();
  const { openSettings } = useSettingsModal();
  const openNotificationSettings = useCallback(
    () => openSettings({ deepLink: { kind: "global", section: "notifications" } }),
    [openSettings],
  );
  const reloadApplication = useCallback(() => window.location.reload(), []);
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
    <FeatureTourProvider>
      <SettingsModalProvider>
        <DiagnosticsPanelProvider>
          <NotificationFailurePromptHost />
          <TaskWorkflowActionsProvider>
            {/* One pool for the app, so page and workspace switches keep the warm diff workers. */}
            <DiffWorkerProvider>
              <AgentSessionTranscriptDialogHost>
                <NotificationNavigationRegistrar />
                <NotificationAttentionFocus />
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
        </DiagnosticsPanelProvider>
      </SettingsModalProvider>
    </FeatureTourProvider>
  );
}
