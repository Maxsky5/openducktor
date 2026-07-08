import type { PropsWithChildren, ReactElement } from "react";
import { AgentSessionTranscriptDialogHost } from "@/components/features/agents/agent-chat/use-agent-session-transcript-dialog";
import { AppUpdatePrompt } from "@/components/features/app-updates/app-update-prompt";

// Central composition layer for cross-page overlays that can be opened from anywhere in the app.
export function ApplicationOverlays({ children }: PropsWithChildren): ReactElement {
  return (
    <AgentSessionTranscriptDialogHost>
      {children}
      <AppUpdatePrompt />
    </AgentSessionTranscriptDialogHost>
  );
}
