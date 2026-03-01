import type {
  BeadsCheck,
  RunEvent,
  RunSummary,
  RuntimeCheck,
  TaskCard,
} from "@openducktor/contracts";
import { type Context, createContext, type Dispatch, type SetStateAction, useContext } from "react";
import type { RepoOpencodeHealthCheck } from "@/types/diagnostics";
import type {
  AgentStateContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";

export const WorkspaceStateContext = createContext<WorkspaceStateContextValue | null>(null);
export const ChecksStateContext = createContext<ChecksStateContextValue | null>(null);
export const TasksStateContext = createContext<TasksStateContextValue | null>(null);
export const DelegationStateContext = createContext<DelegationStateContextValue | null>(null);
export const SpecStateContext = createContext<SpecStateContextValue | null>(null);
export const AgentStateContext = createContext<AgentStateContextValue | null>(null);

export type ActiveRepoContextValue = {
  activeRepo: string | null;
  setActiveRepo: Dispatch<SetStateAction<string | null>>;
};

export type ChecksOperationsContextValue = {
  refreshRuntimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
  refreshRepoOpencodeHealthForRepo: (
    repoPath: string,
    force?: boolean,
  ) => Promise<RepoOpencodeHealthCheck>;
  clearActiveBeadsCheck: () => void;
  clearActiveRepoOpencodeHealth: () => void;
  setIsLoadingChecks: (value: boolean) => void;
  hasRuntimeCheck: () => boolean;
  hasCachedBeadsCheck: (repoPath: string) => boolean;
  hasCachedRepoOpencodeHealth: (repoPath: string) => boolean;
};

export type TaskDataContextValue = {
  tasks: TaskCard[];
  runs: RunSummary[];
};

export type TaskControlContextValue = {
  refreshTaskData: (repoPath: string) => Promise<void>;
  clearTaskData: () => void;
  setIsLoadingTasks: (value: boolean) => void;
};

export type WorkspaceOperationsContextValue = {
  refreshWorkspaces: () => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  clearBranchData: () => void;
};

export type DelegationEventsContextValue = {
  setEvents: Dispatch<SetStateAction<RunEvent[]>>;
};

export const ActiveRepoContext = createContext<ActiveRepoContextValue | null>(null);
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

export const useActiveRepoContext = (): ActiveRepoContextValue =>
  useRequiredContext(ActiveRepoContext, "useActiveRepoContext");

export const useChecksOperationsContext = (): ChecksOperationsContextValue =>
  useRequiredContext(ChecksOperationsContext, "useChecksOperationsContext");

export const useTaskDataContext = (): TaskDataContextValue =>
  useRequiredContext(TaskDataContext, "useTaskDataContext");

export const useTaskControlContext = (): TaskControlContextValue =>
  useRequiredContext(TaskControlContext, "useTaskControlContext");

export const useWorkspaceOperationsContext = (): WorkspaceOperationsContextValue =>
  useRequiredContext(WorkspaceOperationsContext, "useWorkspaceOperationsContext");

export const useDelegationEventsContext = (): DelegationEventsContextValue =>
  useRequiredContext(DelegationEventsContext, "useDelegationEventsContext");
