import { type PropsWithChildren, type ReactElement, useCallback } from "react";
import { AgentSessionTranscriptDialogHost } from "@/components/features/agents/agent-chat/use-agent-session-transcript-dialog";
import { AppUpdatePrompt } from "@/components/features/app-updates/app-update-prompt";
import {
  SettingsModalProvider,
  useSettingsModal,
} from "@/components/features/settings/settings-modal";
import { NotificationFailurePrompt } from "@/features/notifications/notification-failure-prompt";
import {
  NotificationAttentionFocus,
  NotificationNavigationRegistrar,
} from "@/features/notifications/notification-navigation";
import { useNotificationContext } from "@/state/notifications/notification-context";

function NotificationFailurePromptHost(): ReactElement {
  const { osFailure } = useNotificationContext();
  const { openSettings } = useSettingsModal();
  const openNotificationSettings = useCallback(
    () => openSettings({ deepLink: { kind: "global", section: "notifications" } }),
    [openSettings],
  );
  return (
    <NotificationFailurePrompt failure={osFailure} onOpenSettings={openNotificationSettings} />
  );
}

// Central composition layer for cross-page overlays that can be opened from anywhere in the app.
export function ApplicationOverlays({ children }: PropsWithChildren): ReactElement {
  return (
    <SettingsModalProvider>
      <NotificationFailurePromptHost />
      <AgentSessionTranscriptDialogHost>
        <NotificationNavigationRegistrar />
        <NotificationAttentionFocus />
        {children}
        <AppUpdatePrompt />
      </AgentSessionTranscriptDialogHost>
    </SettingsModalProvider>
  );
}
