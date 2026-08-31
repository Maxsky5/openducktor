import type { PropsWithChildren, ReactElement } from "react";
import { AgentSessionTranscriptDialogHost } from "@/components/features/agents/agent-chat/use-agent-session-transcript-dialog";
import { AppUpdatePrompt } from "@/components/features/app-updates/app-update-prompt";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import {
  NotificationAttentionFocus,
  NotificationNavigationRegistrar,
} from "@/features/notifications";

// Central composition layer for cross-page overlays that can be opened from anywhere in the app.
export function ApplicationOverlays({ children }: PropsWithChildren): ReactElement {
  return (
    <SettingsModalProvider>
      <AgentSessionTranscriptDialogHost>
        <NotificationNavigationRegistrar />
        <NotificationAttentionFocus />
        {children}
        <AppUpdatePrompt />
      </AgentSessionTranscriptDialogHost>
    </SettingsModalProvider>
  );
}
