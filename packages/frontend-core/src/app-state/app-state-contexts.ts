import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type { AgentRuntimes, RuntimeDescriptor, WorkspaceRecord } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import {
  type Context,
  createContext,
  type Dispatch,
  type SetStateAction,
  use,
  useMemo,
} from "react";
import type { ActiveWorkspace } from "../types/session-slices";
import type {
  DelegationStateContextValue,
  DocumentStateContextValue,
  TasksStateContextValue,
} from "../types/state-slices";

export const TasksStateContext = createContext<TasksStateContextValue | null>(null);
export const DelegationStateContext = createContext<DelegationStateContextValue | null>(null);
export const DocumentStateContext = createContext<DocumentStateContextValue | null>(null);

export type ActiveWorkspaceContextValue = {
  activeWorkspace: ActiveWorkspace | null;
  setActiveWorkspace: Dispatch<SetStateAction<ActiveWorkspace | null>>;
};

/**
 * The open workspaces and the selected one. The session and activity providers read only this
 * scope, so a platform supplies it without workspace administration.
 */
export type WorkspaceScopeContextValue = {
  workspaces: WorkspaceRecord[];
  activeWorkspace: WorkspaceRecord | null;
};

export type RuntimeDefinitionsContextValue = {
  runtimeDefinitions: RuntimeDescriptor[];
  availableRuntimeDefinitions: RuntimeDescriptor[];
  agentRuntimes: AgentRuntimes;
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  refreshRuntimeDefinitions: () => Promise<RuntimeDescriptor[]>;
  isLoadingRuntimeSettings: boolean;
  runtimeSettingsError: string | null;
  hasRuntimeSettingsSnapshot: boolean;
  refreshRuntimeSettings: () => Promise<void>;
  loadRepoRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
  loadRepoRuntimeFileSearch: (
    runtimeRef: RuntimeWorkingDirectoryRef,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
};

export type TaskSnapshotContextValue = {
  tasks: TaskCard[];
  isLoadingTasks: boolean;
};

export type TaskRefreshOptions = {
  trigger?: "manual" | "scheduled";
};

export type TaskControlContextValue = {
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  loadWorkspaceTasks: (repoPath: string) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  clearTaskData: () => void;
  setIsLoadingTasks: (value: boolean) => void;
};

export const ActiveWorkspaceContext = createContext<ActiveWorkspaceContextValue | null>(null);
export const WorkspaceScopeContext = createContext<WorkspaceScopeContextValue | null>(null);
export const RuntimeDefinitionsContext = createContext<RuntimeDefinitionsContextValue | null>(null);
export const TaskSnapshotContext = createContext<TaskSnapshotContextValue | null>(null);
export const TaskControlContext = createContext<TaskControlContextValue | null>(null);

export const useRequiredContext = <T>(context: Context<T | null>, name: string): T => {
  const value = use(context);
  if (!value) {
    throw new Error(`${name} must be used inside AppStateProvider`);
  }
  return value;
};

export const useActiveWorkspaceContext = (): ActiveWorkspaceContextValue =>
  useRequiredContext(ActiveWorkspaceContext, "useActiveWorkspaceContext");

export const useRuntimeDefinitionsContext = (): RuntimeDefinitionsContextValue =>
  useRequiredContext(RuntimeDefinitionsContext, "useRuntimeDefinitionsContext");

export type RuntimeAvailabilityContextValue = Omit<
  RuntimeDefinitionsContextValue,
  "runtimeDefinitions"
> & {
  allRuntimeDefinitions: RuntimeDescriptor[];
};

export const useRuntimeAvailabilityContext = (): RuntimeAvailabilityContextValue => {
  const runtimeContext = useRuntimeDefinitionsContext();
  return useMemo(
    () => ({
      availableRuntimeDefinitions: runtimeContext.availableRuntimeDefinitions,
      allRuntimeDefinitions: runtimeContext.runtimeDefinitions,
      agentRuntimes: runtimeContext.agentRuntimes,
      isLoadingRuntimeDefinitions: runtimeContext.isLoadingRuntimeDefinitions,
      runtimeDefinitionsError: runtimeContext.runtimeDefinitionsError,
      refreshRuntimeDefinitions: runtimeContext.refreshRuntimeDefinitions,
      isLoadingRuntimeSettings: runtimeContext.isLoadingRuntimeSettings,
      runtimeSettingsError: runtimeContext.runtimeSettingsError,
      hasRuntimeSettingsSnapshot: runtimeContext.hasRuntimeSettingsSnapshot,
      refreshRuntimeSettings: runtimeContext.refreshRuntimeSettings,
      loadRepoRuntimeCatalog: runtimeContext.loadRepoRuntimeCatalog,
      loadRepoRuntimeFileSearch: runtimeContext.loadRepoRuntimeFileSearch,
    }),
    [runtimeContext],
  );
};

export const useTaskSnapshotContext = (): TaskSnapshotContextValue =>
  useRequiredContext(TaskSnapshotContext, "useTaskSnapshotContext");

export const useTaskControlContext = (): TaskControlContextValue =>
  useRequiredContext(TaskControlContext, "useTaskControlContext");
