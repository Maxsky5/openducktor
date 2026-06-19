import type { RuntimeKind } from "@openducktor/contracts";
import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
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
  WorkspaceStateContext,
} from "./app-state-contexts";
import { AgentStudioStateProvider } from "./providers/agent-studio-state-provider";
import { AppLifecycleStateProvider } from "./providers/app-lifecycle-state-provider";
import { AppRuntimeProvider } from "./providers/app-runtime-provider";
import { AutopilotProvider } from "./providers/autopilot-provider";
import { ChecksStateProvider } from "./providers/checks-state-provider";
import { DelegationStateProvider } from "./providers/delegation-state-provider";
import { RepoRuntimeHealthProvider } from "./providers/repo-runtime-health-provider";
import { SpecStateProvider } from "./providers/spec-state-provider";
import { TasksStateProvider } from "./providers/tasks-state-provider";
import { WorkspaceStateProvider } from "./providers/workspace-state-provider";

export function AppStateProvider({ children }: PropsWithChildren): ReactElement {
  const { agentEngine, runtimeCatalogOperations } = useMemo(() => createAgentRuntimeServices(), []);
  const checkRepoRuntimeHealth = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind) =>
      runtimeCatalogOperations.checkRepoRuntimeHealth(repoPath, runtimeKind),
    [runtimeCatalogOperations],
  );

  return (
    <AppRuntimeProvider
      loadRepoRuntimeCatalog={runtimeCatalogOperations.loadRepoRuntimeCatalog}
      loadRepoRuntimeSlashCommands={runtimeCatalogOperations.loadRepoRuntimeSlashCommands}
      loadRepoRuntimeSkills={runtimeCatalogOperations.loadRepoRuntimeSkills}
      loadRepoRuntimeFileSearch={runtimeCatalogOperations.loadRepoRuntimeFileSearch}
    >
      <SpecStateProvider>
        <RepoRuntimeHealthProvider checkRepoRuntimeHealth={checkRepoRuntimeHealth}>
          <ChecksStateProvider>
            <TasksStateProvider>
              <WorkspaceStateProvider>
                <DelegationStateProvider>
                  <AgentStudioStateProvider agentEngine={agentEngine}>
                    <AppLifecycleStateProvider>
                      <AutopilotProvider>{children}</AutopilotProvider>
                    </AppLifecycleStateProvider>
                  </AgentStudioStateProvider>
                </DelegationStateProvider>
              </WorkspaceStateProvider>
            </TasksStateProvider>
          </ChecksStateProvider>
        </RepoRuntimeHealthProvider>
      </SpecStateProvider>
    </AppRuntimeProvider>
  );
}

export const useWorkspaceState = (): WorkspaceStateContextValue =>
  useRequiredContext(WorkspaceStateContext, "useWorkspaceState");

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
