import type {
  AgentRuntimes,
  RepoRuntimeRef,
  RuntimeCheck,
  RuntimeDescriptor,
  TaskCard,
  TaskStoreCheck,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
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
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionHistoryLoadContextValue,
  AgentSessionReadModelStateContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  RepoRuntimeHealthContextValue,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceBranchStateContextValue,
  WorkspacePresenceContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import type { AgentSessionsStore } from "./agent-sessions-store";

export const WorkspaceStateContext = createContext<WorkspaceStateContextValue | null>(null);
export const WorkspaceBranchStateContext = createContext<WorkspaceBranchStateContextValue | null>(
  null,
);
export const WorkspacePresenceContext = createContext<WorkspacePresenceContextValue | null>(null);
export const RepoRuntimeHealthContext = createContext<RepoRuntimeHealthContextValue | null>(null);
export const ChecksStateContext = createContext<ChecksStateContextValue | null>(null);
export const TasksStateContext = createContext<TasksStateContextValue | null>(null);
export const DelegationStateContext = createContext<DelegationStateContextValue | null>(null);
export const SpecStateContext = createContext<SpecStateContextValue | null>(null);
export const AgentSessionsContext = createContext<AgentSessionsStore | null>(null);
export const AgentOperationsContext = createContext<AgentOperationsContextValue | null>(null);
export const AgentSessionHistoryLoadContext =
  createContext<AgentSessionHistoryLoadContextValue | null>(null);
export const AgentSessionReadModelStateContext =
  createContext<AgentSessionReadModelStateContextValue | null>(null);

export type ActiveWorkspaceContextValue = {
  activeWorkspace: ActiveWorkspace | null;
  setActiveWorkspace: Dispatch<SetStateAction<ActiveWorkspace | null>>;
};

export type RuntimeDefinitionsContextValue = {
  runtimeDefinitions: RuntimeDescriptor[];
  availableRuntimeDefinitions: RuntimeDescriptor[];
  agentRuntimes: AgentRuntimes;
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  refreshRuntimeDefinitions: () => Promise<RuntimeDescriptor[]>;
  loadRepoRuntimeCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
  loadRepoRuntimeSlashCommands: (
    runtimeRef: RuntimeWorkingDirectoryRef,
  ) => Promise<AgentSlashCommandCatalog>;
  loadRepoRuntimeSkills: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentSkillCatalog>;
  loadRepoRuntimeSubagents: (
    runtimeRef: RuntimeWorkingDirectoryRef,
  ) => Promise<AgentSubagentCatalog>;
  loadRepoRuntimeFileSearch: (
    runtimeRef: RuntimeWorkingDirectoryRef,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
};

export type ChecksOperationsContextValue = {
  refreshRuntimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
  clearActiveTaskStoreCheck: () => void;
  setIsLoadingChecks: (value: boolean) => void;
  hasRuntimeCheck: () => boolean;
  hasCachedTaskStoreCheck: (repoPath: string) => boolean;
};

export type TaskSnapshotContextValue = {
  tasks: TaskCard[];
  isLoadingTasks: boolean;
};

export type TaskRefreshOptions = {
  trigger?: "manual" | "scheduled";
};

export type TaskDataRefreshOptions = {
  forceFreshTaskList?: boolean;
  source?: "external-sync";
};

export type TaskControlContextValue = {
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: TaskDataRefreshOptions,
  ) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  clearTaskData: () => void;
  setIsLoadingTasks: (value: boolean) => void;
};

export type WorkspaceOperationsContextValue = {
  refreshWorkspaces: () => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  clearBranchData: () => void;
};

export const ActiveWorkspaceContext = createContext<ActiveWorkspaceContextValue | null>(null);
export const RuntimeDefinitionsContext = createContext<RuntimeDefinitionsContextValue | null>(null);
export const ChecksOperationsContext = createContext<ChecksOperationsContextValue | null>(null);
export const TaskSnapshotContext = createContext<TaskSnapshotContextValue | null>(null);
export const TaskControlContext = createContext<TaskControlContextValue | null>(null);
export const WorkspaceOperationsContext = createContext<WorkspaceOperationsContextValue | null>(
  null,
);

export const useRequiredContext = <T>(context: Context<T | null>, name: string): T => {
  const value = use(context);
  if (!value) {
    throw new Error(`${name} must be used inside AppStateProvider`);
  }
  return value;
};

export const useActiveWorkspaceContext = (): ActiveWorkspaceContextValue =>
  useRequiredContext(ActiveWorkspaceContext, "useActiveWorkspaceContext");

export const useChecksOperationsContext = (): ChecksOperationsContextValue =>
  useRequiredContext(ChecksOperationsContext, "useChecksOperationsContext");

export const useChecksStateContext = (): ChecksStateContextValue =>
  useRequiredContext(ChecksStateContext, "useChecksStateContext");

export const useRepoRuntimeHealthContext = (): RepoRuntimeHealthContextValue =>
  useRequiredContext(RepoRuntimeHealthContext, "useRepoRuntimeHealthContext");

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
      loadRepoRuntimeCatalog: runtimeContext.loadRepoRuntimeCatalog,
      loadRepoRuntimeSlashCommands: runtimeContext.loadRepoRuntimeSlashCommands,
      loadRepoRuntimeSkills: runtimeContext.loadRepoRuntimeSkills,
      loadRepoRuntimeSubagents: runtimeContext.loadRepoRuntimeSubagents,
      loadRepoRuntimeFileSearch: runtimeContext.loadRepoRuntimeFileSearch,
    }),
    [runtimeContext],
  );
};

export const useTaskSnapshotContext = (): TaskSnapshotContextValue =>
  useRequiredContext(TaskSnapshotContext, "useTaskSnapshotContext");

export const useTaskControlContext = (): TaskControlContextValue =>
  useRequiredContext(TaskControlContext, "useTaskControlContext");

export const useWorkspaceOperationsContext = (): WorkspaceOperationsContextValue =>
  useRequiredContext(WorkspaceOperationsContext, "useWorkspaceOperationsContext");

export const useAgentSessionsContext = (): AgentSessionsStore =>
  useRequiredContext(AgentSessionsContext, "useAgentSessions");

export const useAgentOperationsContext = (): AgentOperationsContextValue =>
  useRequiredContext(AgentOperationsContext, "useAgentOperations");

export const useAgentSessionHistoryLoadContext = (): AgentSessionHistoryLoadContextValue =>
  useRequiredContext(AgentSessionHistoryLoadContext, "useAgentSessionHistoryLoadContext");

export const useAgentSessionReadModelStateContext = (): AgentSessionReadModelStateContextValue =>
  useRequiredContext(AgentSessionReadModelStateContext, "useAgentSessionReadModelState");

export const useWorkspaceStateContext = (): WorkspaceStateContextValue =>
  useRequiredContext(WorkspaceStateContext, "useWorkspaceState");

export const useWorkspaceBranchStateContext = (): WorkspaceBranchStateContextValue =>
  useRequiredContext(WorkspaceBranchStateContext, "useWorkspaceBranchState");

export const useWorkspacePresenceContext = (): WorkspacePresenceContextValue =>
  useRequiredContext(WorkspacePresenceContext, "useWorkspacePresence");
