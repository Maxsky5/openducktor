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
  AgentOperationsContextValue,
  AgentStateContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { createAgentRuntimeRegistry } from "./agent-runtime-registry";
import type { AgentSessionSummary } from "./agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionsContext,
  ChecksStateContext,
  DelegationStateContext,
  SpecStateContext,
  TasksStateContext,
  useAgentOperationsContext,
  useAgentSessionsContext,
  useRequiredContext,
  WorkspaceStateContext,
} from "./app-state-contexts";
import { createHostRuntimeCatalogOperations } from "./operations";
import {
  AgentStudioStateProvider,
  AppLifecycleStateProvider,
  AppRuntimeProvider,
  AutopilotProvider,
  ChecksStateProvider,
  DelegationStateProvider,
  SpecStateProvider,
  TasksStateProvider,
  WorkspaceStateProvider,
} from "./providers";

export function AppStateProvider({ children }: PropsWithChildren): ReactElement {
  const runtimeRegistry = useMemo(() => createAgentRuntimeRegistry(), []);
  const agentEngine = useMemo(() => runtimeRegistry.createAgentEngine(), [runtimeRegistry]);
  const runtimeCatalogOperations = useMemo(() => {
    return createHostRuntimeCatalogOperations(
      runtimeRegistry.getAdapter,
      runtimeRegistry.getRuntimeDefinition,
    );
  }, [runtimeRegistry]);
  const checkRepoRuntimeHealth = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind) =>
      runtimeCatalogOperations.checkRepoRuntimeHealth(repoPath, runtimeKind),
    [runtimeCatalogOperations],
  );

  return (
    <AppRuntimeProvider
      loadRepoRuntimeCatalog={runtimeCatalogOperations.loadRepoRuntimeCatalog}
      loadRepoRuntimeSlashCommands={runtimeCatalogOperations.loadRepoRuntimeSlashCommands}
      loadRepoRuntimeFileSearch={runtimeCatalogOperations.loadRepoRuntimeFileSearch}
    >
      <SpecStateProvider>
        <ChecksStateProvider checkRepoRuntimeHealth={checkRepoRuntimeHealth}>
          <TasksStateProvider>
            <DelegationStateProvider>
              <WorkspaceStateProvider>
                <AgentStudioStateProvider agentEngine={agentEngine}>
                  <AppLifecycleStateProvider>
                    <AutopilotProvider>{children}</AutopilotProvider>
                  </AppLifecycleStateProvider>
                </AgentStudioStateProvider>
              </WorkspaceStateProvider>
            </DelegationStateProvider>
          </TasksStateProvider>
        </ChecksStateProvider>
      </SpecStateProvider>
    </AppRuntimeProvider>
  );
}

export const useWorkspaceState = (): WorkspaceStateContextValue =>
  useRequiredContext(WorkspaceStateContext, "useWorkspaceState");

export const useChecksState = (): ChecksStateContextValue =>
  useRequiredContext(ChecksStateContext, "useChecksState");

export const useTasksState = (): TasksStateContextValue =>
  useRequiredContext(TasksStateContext, "useTasksState");

export const useDelegationState = (): DelegationStateContextValue =>
  useRequiredContext(DelegationStateContext, "useDelegationState");

export const useSpecState = (): SpecStateContextValue =>
  useRequiredContext(SpecStateContext, "useSpecState");

export const useAgentOperations = (): AgentOperationsContextValue => useAgentOperationsContext();

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

export const useAgentSession = (sessionId: string | null): AgentSessionState | null => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getSessionSnapshot(sessionId),
    () => sessionStore.getSessionSnapshot(sessionId),
  );
};

export const useAgentState = (): AgentStateContextValue => {
  const sessionStore = useRequiredContext(AgentSessionsContext, "useAgentState");
  const operations = useRequiredContext(AgentOperationsContext, "useAgentState");
  const sessions = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSessionsSnapshot,
    sessionStore.getSessionsSnapshot,
  );

  return useMemo(
    () => ({
      sessions,
      ...operations,
    }),
    [operations, sessions],
  );
};
