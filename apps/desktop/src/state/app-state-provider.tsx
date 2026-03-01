import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import type {
  AgentStateContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  RepoSettingsInput,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
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
  configureOpencodeCatalogOperations,
  createHostOpencodeCatalogOperations,
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
  const agentEngine = useMemo(() => new OpencodeSdkAdapter(), []);
  const opencodeCatalogOperations = useMemo(() => {
    const ops = createHostOpencodeCatalogOperations(agentEngine);
    configureOpencodeCatalogOperations(ops);
    return ops;
  }, [agentEngine]);

  return (
    <AppRuntimeProvider>
      <SpecStateProvider>
        <ChecksStateProvider
          checkRepoOpencodeHealth={opencodeCatalogOperations.checkRepoOpencodeHealth}
        >
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
