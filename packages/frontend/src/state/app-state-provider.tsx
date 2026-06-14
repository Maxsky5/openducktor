import type { RuntimeKind } from "@openducktor/contracts";
import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
  AgentStateContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceBranchStateContextValue,
  WorkspacePresenceContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { createAgentRuntimeRegistry } from "./agent-runtime-registry";
import type {
  AgentActivitySessionSummary,
  AgentActivitySessionsSnapshot,
  AgentSessionSummary,
} from "./agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionsContext,
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
import { createHostRuntimeCatalogOperations } from "./operations/shared/runtime-catalog";
import { ensureRuntimeAndInvalidateReadinessQueries } from "./operations/shared/runtime-readiness-publication";
import { AgentStudioStateProvider } from "./providers/agent-studio-state-provider";
import { AppLifecycleStateProvider } from "./providers/app-lifecycle-state-provider";
import { AppRuntimeProvider } from "./providers/app-runtime-provider";
import { AutopilotProvider } from "./providers/autopilot-provider";
import { ChecksStateProvider } from "./providers/checks-state-provider";
import { DelegationStateProvider } from "./providers/delegation-state-provider";
import { SpecStateProvider } from "./providers/spec-state-provider";
import { TasksStateProvider } from "./providers/tasks-state-provider";
import { WorkspaceStateProvider } from "./providers/workspace-state-provider";

export function AppStateProvider({ children }: PropsWithChildren): ReactElement {
  const runtimeRegistry = useMemo(() => createAgentRuntimeRegistry(), []);
  const agentEngine = useMemo(() => runtimeRegistry.createAgentEngine(), [runtimeRegistry]);
  const runtimeCatalogOperations = useMemo(() => {
    return createHostRuntimeCatalogOperations(runtimeRegistry.getAdapter);
  }, [runtimeRegistry]);
  const checkRepoRuntimeHealth = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind) =>
      runtimeCatalogOperations.checkRepoRuntimeHealth(repoPath, runtimeKind),
    [runtimeCatalogOperations],
  );
  const startRepoRuntime = useCallback(
    async (repoPath: string, runtimeKind: RuntimeKind): Promise<void> => {
      await ensureRuntimeAndInvalidateReadinessQueries({
        repoPath,
        runtimeKind,
        ensureRuntime: (nextRepoPath, nextRuntimeKind) =>
          runtimeRegistry.startRepoRuntime({
            repoPath: nextRepoPath,
            runtimeKind: nextRuntimeKind,
          }),
      });
    },
    [runtimeRegistry],
  );

  return (
    <AppRuntimeProvider
      loadRepoRuntimeCatalog={runtimeCatalogOperations.loadRepoRuntimeCatalog}
      loadRepoRuntimeSlashCommands={runtimeCatalogOperations.loadRepoRuntimeSlashCommands}
      loadRepoRuntimeSkills={runtimeCatalogOperations.loadRepoRuntimeSkills}
      loadRepoRuntimeFileSearch={runtimeCatalogOperations.loadRepoRuntimeFileSearch}
    >
      <SpecStateProvider>
        <ChecksStateProvider checkRepoRuntimeHealth={checkRepoRuntimeHealth}>
          <TasksStateProvider>
            <WorkspaceStateProvider>
              <DelegationStateProvider>
                <AgentStudioStateProvider agentEngine={agentEngine}>
                  <AppLifecycleStateProvider startRepoRuntime={startRepoRuntime}>
                    <AutopilotProvider>{children}</AutopilotProvider>
                  </AppLifecycleStateProvider>
                </AgentStudioStateProvider>
              </DelegationStateProvider>
            </WorkspaceStateProvider>
          </TasksStateProvider>
        </ChecksStateProvider>
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

export const useAgentSessions = (): AgentStateContextValue["sessions"] => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSessionsSnapshot,
    sessionStore.getSessionsSnapshot,
  );
};

export const useAgentSessionSummaries = (): AgentSessionSummary[] => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSessionSummariesSnapshot,
    sessionStore.getSessionSummariesSnapshot,
  );
};

export const useAgentActivitySessions = (): AgentActivitySessionSummary[] => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getActivitySessionsSnapshot,
    sessionStore.getActivitySessionsSnapshot,
  );
};

export const useAgentActivitySnapshot = (): AgentActivitySessionsSnapshot => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getActivitySnapshot,
    sessionStore.getActivitySnapshot,
  );
};

export const useAgentSession = (externalSessionId: string | null): AgentSessionState | null => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getSessionSnapshot(externalSessionId),
    () => sessionStore.getSessionSnapshot(externalSessionId),
  );
};

export const useAgentState = (): AgentStateContextValue => {
  const sessionStore = useRequiredContext(AgentSessionsContext, "useAgentState");
  const operations = useRequiredContext(AgentOperationsContext, "useAgentState");
  const readModelState = useAgentSessionReadModelStateContext();
  const sessions = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSessionsSnapshot,
    sessionStore.getSessionsSnapshot,
  );

  return useMemo(
    () => ({
      sessions,
      ...readModelState,
      ...operations,
    }),
    [operations, readModelState, sessions],
  );
};
