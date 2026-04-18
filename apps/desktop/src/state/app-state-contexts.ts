import type {
  BeadsCheck,
  RunEvent,
  RunSummary,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { type Context, createContext, type Dispatch, type SetStateAction, useContext } from "react";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import type { AgentSessionsStore } from "./agent-sessions-store";

export const WorkspaceStateContext = createContext<WorkspaceStateContextValue | null>(null);
export const ChecksStateContext = createContext<ChecksStateContextValue | null>(null);
export const TasksStateContext = createContext<TasksStateContextValue | null>(null);
export const DelegationStateContext = createContext<DelegationStateContextValue | null>(null);
export const SpecStateContext = createContext<SpecStateContextValue | null>(null);
export const AgentSessionsContext = createContext<AgentSessionsStore | null>(null);
export const AgentOperationsContext = createContext<AgentOperationsContextValue | null>(null);

export type ActiveWorkspaceContextValue = {
  activeWorkspace: ActiveWorkspace | null;
  setActiveWorkspace: Dispatch<SetStateAction<ActiveWorkspace | null>>;
};

export type RuntimeDefinitionsContextValue = {
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  refreshRuntimeDefinitions: () => Promise<RuntimeDescriptor[]>;
  loadRepoRuntimeCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>;
  loadRepoRuntimeSlashCommands: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>;
  loadRepoRuntimeFileSearch: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
};

export type ChecksOperationsContextValue = {
  refreshRuntimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
  refreshRepoRuntimeHealthForRepo: (
    repoPath: string,
    force?: boolean,
  ) => Promise<RepoRuntimeHealthMap>;
  clearActiveBeadsCheck: () => void;
  clearActiveRepoRuntimeHealth: () => void;
  setIsLoadingChecks: (value: boolean) => void;
  hasRuntimeCheck: () => boolean;
  hasCachedBeadsCheck: (repoPath: string) => boolean;
  hasCachedRepoRuntimeHealth: (repoPath: string, runtimeKinds: RuntimeKind[]) => boolean;
};

export type TaskDataContextValue = {
  tasks: TaskCard[];
  runs: RunSummary[];
};

export type TaskRefreshOptions = {
  trigger?: "manual" | "scheduled";
};

export type TaskControlContextValue = {
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  clearTaskData: () => void;
  setIsLoadingTasks: (value: boolean) => void;
};

export type WorkspaceOperationsContextValue = {
  refreshWorkspaces: () => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  clearBranchData: () => void;
};

export type RunCompletionSignal = {
  runId: string;
  eventType: RunEvent["type"];
  version: number;
};

export type DelegationEventsContextValue = {
  setEvents: Dispatch<SetStateAction<RunEvent[]>>;
  runCompletionSignal: RunCompletionSignal | null;
  setRunCompletionSignal: (runId: string, eventType: RunEvent["type"]) => void;
};

export const ActiveWorkspaceContext = createContext<ActiveWorkspaceContextValue | null>(null);
export const RuntimeDefinitionsContext = createContext<RuntimeDefinitionsContextValue | null>(null);
export const ChecksOperationsContext = createContext<ChecksOperationsContextValue | null>(null);
export const TaskDataContext = createContext<TaskDataContextValue | null>(null);
export const TaskControlContext = createContext<TaskControlContextValue | null>(null);
export const WorkspaceOperationsContext = createContext<WorkspaceOperationsContextValue | null>(
  null,
);
export const DelegationEventsContext = createContext<DelegationEventsContextValue | null>(null);

export const useRequiredContext = <T>(context: Context<T | null>, name: string): T => {
  const value = useContext(context);
  if (!value) {
    throw new Error(`${name} must be used inside AppStateProvider`);
  }
  return value;
};

export const useActiveWorkspaceContext = (): ActiveWorkspaceContextValue =>
  useRequiredContext(ActiveWorkspaceContext, "useActiveWorkspaceContext");

export const useChecksOperationsContext = (): ChecksOperationsContextValue =>
  useRequiredContext(ChecksOperationsContext, "useChecksOperationsContext");

export const useRuntimeDefinitionsContext = (): RuntimeDefinitionsContextValue =>
  useRequiredContext(RuntimeDefinitionsContext, "useRuntimeDefinitionsContext");

export const useTaskDataContext = (): TaskDataContextValue =>
  useRequiredContext(TaskDataContext, "useTaskDataContext");

export const useTaskControlContext = (): TaskControlContextValue =>
  useRequiredContext(TaskControlContext, "useTaskControlContext");

export const useWorkspaceOperationsContext = (): WorkspaceOperationsContextValue =>
  useRequiredContext(WorkspaceOperationsContext, "useWorkspaceOperationsContext");

export const useDelegationEventsContext = (): DelegationEventsContextValue =>
  useRequiredContext(DelegationEventsContext, "useDelegationEventsContext");

export const useAgentSessionsContext = (): AgentSessionsStore =>
  useRequiredContext(AgentSessionsContext, "useAgentSessions");

export const useAgentOperationsContext = (): AgentOperationsContextValue =>
  useRequiredContext(AgentOperationsContext, "useAgentOperations");
