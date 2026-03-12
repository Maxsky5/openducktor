import { type PropsWithChildren, type ReactElement, useCallback, useMemo } from "react";
import type {
  AgentStateContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  RepoSettingsInput,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import type { RuntimeKind } from "@openducktor/contracts";
import { createAgentRuntimeRegistry } from "./agent-runtime-registry";
import {
  AgentStateContext,
  ChecksStateContext,
  DelegationStateContext,
  SpecStateContext,
  TasksStateContext,
  useRequiredContext,
  WorkspaceStateContext,
} from "./app-state-contexts";
import {
  configureRuntimeCatalogOperations,
  createHostRuntimeCatalogOperations,
} from "./operations";
import {
  AgentStudioStateProvider,
  AppLifecycleStateProvider,
  AppRuntimeProvider,
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
    const ops = createHostRuntimeCatalogOperations(
      runtimeRegistry.getAdapter,
      runtimeRegistry.getRuntimeDefinition,
    );
    configureRuntimeCatalogOperations(ops);
    return ops;
  }, [runtimeRegistry]);
  const checkRepoRuntimeHealth = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind) =>
      runtimeCatalogOperations.checkRepoRuntimeHealth(repoPath, runtimeKind),
    [runtimeCatalogOperations],
  );

  return (
    <AppRuntimeProvider>
      <SpecStateProvider>
        <ChecksStateProvider checkRepoRuntimeHealth={checkRepoRuntimeHealth}>
          <TasksStateProvider>
            <AgentStudioStateProvider agentEngine={agentEngine}>
              <DelegationStateProvider>
                <WorkspaceStateProvider>
                  <AppLifecycleStateProvider>{children}</AppLifecycleStateProvider>
                </WorkspaceStateProvider>
              </DelegationStateProvider>
            </AgentStudioStateProvider>
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

export const useAgentState = (): AgentStateContextValue =>
  useRequiredContext(AgentStateContext, "useAgentState");

export type { RepoSettingsInput };
