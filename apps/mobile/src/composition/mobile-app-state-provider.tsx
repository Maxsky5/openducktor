import { AgentStudioStateProvider } from "@openducktor/frontend-core/app-state/providers/agent-studio-state-provider";
import { AppRuntimeProvider } from "@openducktor/frontend-core/app-state/providers/app-runtime-provider";
import { DelegationStateProvider } from "@openducktor/frontend-core/app-state/providers/delegation-state-provider";
import { HostRuntimeStatusProvider } from "@openducktor/frontend-core/app-state/providers/host-runtime-status-provider";
import { DocumentStateProvider } from "@openducktor/frontend-core/app-state/providers/document-state-provider";
import { TasksStateProvider } from "@openducktor/frontend-core/app-state/providers/tasks-state-provider";
import { WorkspaceActivityProvider } from "@openducktor/frontend-core/app-state/providers/workspace-activity-provider";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { createAgentRuntimeServices } from "@openducktor/frontend-core/sessions/agent-runtime-services";
import { SessionReadStateProvider } from "@openducktor/frontend-core/sessions/navigation/session-read-state";
import { VisibleSessionTargetProvider } from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import { AgentChatTranscriptCacheProvider } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-cache-provider";
import { useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { useDevicePreferences } from "@/app-shell/app-services";
import { appStateVisibility } from "./app-visibility";
import { SettingsRefreshOwner } from "./settings-refresh";
import { TaskStreamOwner } from "./task-stream";
import { WorkspaceSelectionProvider } from "./workspace-selection";

/**
 * Assembles the same frontend-core owners that desktop composes: runtimes, host runtime status,
 * tasks and their task stream, workspace activity for all open workspaces, and the agent
 * orchestrator. Mobile adds its own local workspace selection, device visibility, and a read of the
 * host settings when the app returns to the foreground. It creates no notification runtime. The
 * phone loses its live stream while it sleeps, so the orchestrator reads the history of active and
 * recent sessions after a gap, before the user opens them. Mobile does not keep closed chats
 * mounted, so the transcript cache also builds the transcripts of active sessions out of view, and
 * a running session opens on its latest messages at once.
 */
export function MobileAppStateProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const hostClient = useHostClient();
  const showReasoning = useDevicePreferences((state) => state.preferences.showReasoning);
  const prepareActiveSessions = useMemo(
    () => ({ showThinkingMessages: showReasoning }),
    [showReasoning],
  );
  const { agentEngine, runtimeCatalogOperations } = useMemo(
    () => createAgentRuntimeServices(hostClient, queryClient),
    [hostClient, queryClient],
  );
  return (
    <AppRuntimeProvider
      loadRepoRuntimeCatalog={runtimeCatalogOperations.loadRuntimeCatalog}
      loadRepoRuntimeFileSearch={runtimeCatalogOperations.loadRepoRuntimeFileSearch}
    >
      <DocumentStateProvider>
        <HostRuntimeStatusProvider>
          <TasksStateProvider>
            <WorkspaceSelectionProvider>
              <WorkspaceActivityProvider>
                <DelegationStateProvider>
                  <AgentStudioStateProvider agentEngine={agentEngine} keepActiveTranscriptsCurrent>
                    <TaskStreamOwner />
                    <SettingsRefreshOwner />
                    <VisibleSessionTargetProvider>
                      <SessionReadStateProvider visibility={appStateVisibility}>
                        <AgentChatTranscriptCacheProvider
                          prepareActiveSessions={prepareActiveSessions}
                        >
                          {children}
                        </AgentChatTranscriptCacheProvider>
                      </SessionReadStateProvider>
                    </VisibleSessionTargetProvider>
                  </AgentStudioStateProvider>
                </DelegationStateProvider>
              </WorkspaceActivityProvider>
            </WorkspaceSelectionProvider>
          </TasksStateProvider>
        </HostRuntimeStatusProvider>
      </DocumentStateProvider>
    </AppRuntimeProvider>
  );
}
