import { type PropsWithChildren, type ReactElement, useMemo, useSyncExternalStore } from "react";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceBranchStateContextValue,
  WorkspacePresenceContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { createAgentRuntimeServices } from "./agent-runtime-services";
import type { AgentSessionVisiblePendingInput } from "./agent-session-visible-pending-input";
import type { AgentActivitySessionsSnapshot, AgentSessionSummary } from "./agent-sessions-store";
import {
  ChecksStateContext,
  DelegationStateContext,
  SpecStateContext,
  TasksStateContext,
  useActiveWorkspaceContext,
  useAgentOperationsContext,
  useAgentSessionReadModelStateContext,
  useAgentSessionsContext,
  useRequiredContext,
  useWorkspaceBranchStateContext,
  useWorkspacePresenceContext,
  useWorkspaceStateContext,
} from "./app-state-contexts";
import { AgentStudioStateProvider } from "./providers/agent-studio-state-provider";
import { AppLifecycleStateProvider } from "./providers/app-lifecycle-state-provider";
import { AppRuntimeProvider } from "./providers/app-runtime-provider";
import { AutopilotProvider } from "./providers/autopilot-provider";
import { ChecksStateProvider } from "./providers/checks-state-provider";
import { DelegationStateProvider } from "./providers/delegation-state-provider";
import { DiagnosticsAutoOpenProvider } from "./providers/diagnostics-auto-open-provider";
import { HostRuntimeStatusProvider } from "./providers/host-runtime-status-provider";
import { SpecStateProvider } from "./providers/spec-state-provider";
import { TasksStateProvider } from "./providers/tasks-state-provider";
import { WorkspaceStateProvider } from "./providers/workspace-state-provider";
import { NotificationProvider } from "./providers/notification-provider";
import { WorkspaceActivityProvider } from "./providers/workspace-activity-provider";
import { TerminalActivityProvider } from "./providers/terminal-activity-provider";

import { useQueryClient } from "@tanstack/react-query";
import { workspaceComparisonChoices } from "./workspace-comparison-choices";

export function AppStateProvider({ children }: PropsWithChildren): ReactElement {
  workspaceComparisonChoices(useQueryClient());
  const { agentEngine, runtimeCatalogOperations } = useMemo(() => createAgentRuntimeServices(), []);

  return (
    <AppRuntimeProvider
      loadRepoRuntimeCatalog={runtimeCatalogOperations.loadRuntimeCatalog}
      loadRepoRuntimeFileSearch={runtimeCatalogOperations.loadRepoRuntimeFileSearch}
    >
      <SpecStateProvider>
        <HostRuntimeStatusProvider>
          <DiagnosticsAutoOpenProvider>
            <ChecksStateProvider>
              <TasksStateProvider>
                <WorkspaceStateProvider>
                  <WorkspaceActivityProvider>
                    <NotificationProvider>
                      <DelegationStateProvider>
                        <AgentStudioStateProvider agentEngine={agentEngine}>
                          <AppLifecycleStateProvider>
                            <TerminalActivityProvider>
                              <AutopilotProvider>{children}</AutopilotProvider>
                            </TerminalActivityProvider>
                          </AppLifecycleStateProvider>
                        </AgentStudioStateProvider>
                      </DelegationStateProvider>
                    </NotificationProvider>
                  </WorkspaceActivityProvider>
                </WorkspaceStateProvider>
              </TasksStateProvider>
            </ChecksStateProvider>
          </DiagnosticsAutoOpenProvider>
        </HostRuntimeStatusProvider>
      </SpecStateProvider>
    </AppRuntimeProvider>
  );
}

export const useWorkspaceState = (): WorkspaceStateContextValue => useWorkspaceStateContext();

export const useWorkspaceBranchState = (): WorkspaceBranchStateContextValue =>
  useWorkspaceBranchStateContext();

export const useWorkspacePresence = (): WorkspacePresenceContextValue =>
  useWorkspacePresenceContext();

export const useActiveWorkspace = (): ActiveWorkspace | null =>
  useActiveWorkspaceContext().activeWorkspace;

export const useChecksState = (): ChecksStateContextValue =>
  useRequiredContext(ChecksStateContext, "useChecksState");

export const useTasksState = (): TasksStateContextValue =>
  useRequiredContext(TasksStateContext, "useTasksState");

export const useDelegationState = (): DelegationStateContextValue =>
  useRequiredContext(DelegationStateContext, "useDelegationState");

export const useSpecState = (): SpecStateContextValue =>
  useRequiredContext(SpecStateContext, "useSpecState");

export const useAgentOperations = (): AgentOperationsContextValue => useAgentOperationsContext();

export const useAgentSessionReadModelState = (): AgentSessionReadModelStateContextValue =>
  useAgentSessionReadModelStateContext();

export const useAgentActivitySnapshot = (): AgentActivitySessionsSnapshot => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getActivitySnapshot,
    sessionStore.getActivitySnapshot,
  );
};

export const useAgentSessionSummaries = (): AgentSessionSummary[] =>
  useAgentActivitySnapshot().sessions;

export const useAgentSession = (
  identity: AgentSessionIdentity | null,
): AgentSessionState | null => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getSessionSnapshot(identity),
    () => sessionStore.getSessionSnapshot(identity),
  );
};

export const useAgentSessionVisiblePendingInput = (
  identity: AgentSessionIdentity | null,
): AgentSessionVisiblePendingInput => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getVisiblePendingInputSnapshot(identity),
    () => sessionStore.getVisiblePendingInputSnapshot(identity),
  );
};
