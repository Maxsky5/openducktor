import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import type { RemoteAccessBridge } from "@openducktor/contracts";
import type {
  DelegationStateContextValue,
  DocumentStateContextValue,
  TasksStateContextValue,
} from "@openducktor/frontend-core/types/state-slices";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
  ChecksStateContextValue,
  WorkspaceBranchStateContextValue,
  WorkspacePresenceContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { createAgentRuntimeServices } from "@openducktor/frontend-core/sessions/agent-runtime-services";
import {
  DelegationStateContext,
  DocumentStateContext,
  TasksStateContext,
  useActiveWorkspaceContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  ChecksStateContext,
  useWorkspaceBranchStateContext,
  useWorkspacePresenceContext,
  useWorkspaceStateContext,
} from "./app-state-contexts";
import {
  useAgentOperationsContext,
  useAgentSessionReadModelStateContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { AgentStudioStateProvider } from "@openducktor/frontend-core/app-state/providers/agent-studio-state-provider";
import { AppLifecycleStateProvider } from "./providers/app-lifecycle-state-provider";
import { AppRuntimeProvider } from "@openducktor/frontend-core/app-state/providers/app-runtime-provider";
import { AutopilotProvider } from "./providers/autopilot-provider";
import { ChecksStateProvider } from "./providers/checks-state-provider";
import { DelegationStateProvider } from "@openducktor/frontend-core/app-state/providers/delegation-state-provider";
import { DiagnosticsAutoOpenProvider } from "./providers/diagnostics-auto-open-provider";
import { HostRuntimeStatusProvider } from "@openducktor/frontend-core/app-state/providers/host-runtime-status-provider";
import { ManualMergeCheckProvider } from "./providers/manual-merge-check-provider";
import { ManualPullRequestSyncProvider } from "./providers/manual-pull-request-sync-provider";
import { DocumentStateProvider } from "@openducktor/frontend-core/app-state/providers/document-state-provider";
import { TasksStateProvider } from "@openducktor/frontend-core/app-state/providers/tasks-state-provider";
import { WorkspaceStateProvider } from "./providers/workspace-state-provider";
import { NotificationProvider } from "./providers/notification-provider";
import { WorkspaceActivityProvider } from "@openducktor/frontend-core/app-state/providers/workspace-activity-provider";
import { TerminalActivityProvider } from "./providers/terminal-activity-provider";

import { useQueryClient } from "@tanstack/react-query";
import { RemoteAccessProvider } from "./remote-access-provider";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { getShellBridge } from "@/lib/shell-bridge";

export function ShellStateProvider({
  children,
  remoteAccess,
}: PropsWithChildren<{ remoteAccess: RemoteAccessBridge | undefined }>): ReactElement {
  return <RemoteAccessProvider bridge={remoteAccess}>{children}</RemoteAccessProvider>;
}

export function AppStateProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const hostClient = useHostClient();
  const { agentEngine, runtimeCatalogOperations } = useMemo(
    () =>
      createAgentRuntimeServices(
        hostClient,
        queryClient,
        // A remote host reply has a size limit, so history leaves out long tool details.
        getShellBridge().remoteConnection ? { historyToolDetails: "on_demand" } : {},
      ),
    [hostClient, queryClient],
  );

  return (
    <AppRuntimeProvider
      loadRepoRuntimeCatalog={runtimeCatalogOperations.loadRuntimeCatalog}
      loadRepoRuntimeFileSearch={runtimeCatalogOperations.loadRepoRuntimeFileSearch}
    >
      <DocumentStateProvider>
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
                              <AutopilotProvider>
                                <ManualPullRequestSyncProvider>
                                  <ManualMergeCheckProvider>{children}</ManualMergeCheckProvider>
                                </ManualPullRequestSyncProvider>
                              </AutopilotProvider>
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
      </DocumentStateProvider>
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

export const useDocumentState = (): DocumentStateContextValue =>
  useRequiredContext(DocumentStateContext, "useDocumentState");

export const useAgentOperations = (): AgentOperationsContextValue => useAgentOperationsContext();

export const useAgentSessionReadModelState = (): AgentSessionReadModelStateContextValue =>
  useAgentSessionReadModelStateContext();
