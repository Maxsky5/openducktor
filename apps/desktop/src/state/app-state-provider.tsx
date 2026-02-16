import type {
  ChecksStateContextValue,
  DelegationStateContextValue,
  RepoSettingsInput,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import type { RunEvent } from "@openblueprint/contracts";
import {
  type Context,
  type PropsWithChildren,
  type ReactElement,
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";
import { useAppLifecycle } from "./lifecycle/use-app-lifecycle";
import { useChecks } from "./operations/use-checks";
import { useDelegationOperations } from "./operations/use-delegation-operations";
import { useRepoSettingsOperations } from "./operations/use-repo-settings-operations";
import { useSpecOperations } from "./operations/use-spec-operations";
import { useTaskOperations } from "./operations/use-task-operations";
import { useWorkspaceOperations } from "./operations/use-workspace-operations";

const WorkspaceStateContext = createContext<WorkspaceStateContextValue | null>(null);
const ChecksStateContext = createContext<ChecksStateContextValue | null>(null);
const TasksStateContext = createContext<TasksStateContextValue | null>(null);
const DelegationStateContext = createContext<DelegationStateContextValue | null>(null);
const SpecStateContext = createContext<SpecStateContextValue | null>(null);

const useRequiredContext = <T,>(context: Context<T | null>, name: string): T => {
  const value = useContext(context);
  if (!value) {
    throw new Error(`${name} must be used inside AppStateProvider`);
  }
  return value;
};

export function AppStateProvider({ children }: PropsWithChildren): ReactElement {
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);

  const {
    runtimeCheck,
    activeBeadsCheck,
    isLoadingChecks,
    setIsLoadingChecks,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    clearActiveBeadsCheck,
  } = useChecks({
    activeRepo,
  });

  const {
    tasks,
    runs,
    isLoadingTasks,
    setIsLoadingTasks,
    clearTaskData,
    refreshTaskData,
    refreshTasks,
    createTask,
    updateTask,
    setTaskPhase,
  } = useTaskOperations({
    activeRepo,
    refreshBeadsCheckForRepo,
  });

  const { delegateTask, delegateRespond, delegateStop, delegateCleanup } = useDelegationOperations({
    activeRepo,
    refreshTaskData,
  });

  const { loadSpec, saveSpec } = useSpecOperations({
    activeRepo,
  });

  const { workspaces, isSwitchingWorkspace, refreshWorkspaces, addWorkspace, selectWorkspace } =
    useWorkspaceOperations({
      activeRepo,
      setActiveRepo,
      clearTaskData,
      clearActiveBeadsCheck,
    });

  const { loadRepoSettings, saveRepoSettings } = useRepoSettingsOperations({
    activeRepo,
    refreshWorkspaces,
  });

  useAppLifecycle({
    activeRepo,
    setEvents,
    refreshWorkspaces,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshTaskData,
    clearTaskData,
    clearActiveBeadsCheck,
    setIsLoadingChecks,
    setIsLoadingTasks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
  });

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.path === activeRepo) ?? null,
    [activeRepo, workspaces],
  );

  const workspaceStateValue = useMemo<WorkspaceStateContextValue>(
    () => ({
      isSwitchingWorkspace,
      workspaces,
      activeRepo,
      activeWorkspace,
      addWorkspace,
      selectWorkspace,
      loadRepoSettings,
      saveRepoSettings,
    }),
    [
      activeRepo,
      activeWorkspace,
      addWorkspace,
      isSwitchingWorkspace,
      loadRepoSettings,
      saveRepoSettings,
      selectWorkspace,
      workspaces,
    ],
  );

  const checksStateValue = useMemo<ChecksStateContextValue>(
    () => ({
      runtimeCheck,
      beadsCheck: activeBeadsCheck,
      isLoadingChecks,
      refreshChecks,
    }),
    [activeBeadsCheck, isLoadingChecks, refreshChecks, runtimeCheck],
  );

  const tasksStateValue = useMemo<TasksStateContextValue>(
    () => ({
      isLoadingTasks,
      tasks,
      runs,
      refreshTasks,
      createTask,
      updateTask,
      setTaskPhase,
    }),
    [createTask, isLoadingTasks, refreshTasks, runs, setTaskPhase, tasks, updateTask],
  );

  const delegationStateValue = useMemo<DelegationStateContextValue>(
    () => ({
      events,
      delegateTask,
      delegateRespond,
      delegateStop,
      delegateCleanup,
    }),
    [delegateCleanup, delegateRespond, delegateStop, delegateTask, events],
  );

  const specStateValue = useMemo<SpecStateContextValue>(
    () => ({
      loadSpec,
      saveSpec,
    }),
    [loadSpec, saveSpec],
  );

  return (
    <WorkspaceStateContext.Provider value={workspaceStateValue}>
      <ChecksStateContext.Provider value={checksStateValue}>
        <TasksStateContext.Provider value={tasksStateValue}>
          <DelegationStateContext.Provider value={delegationStateValue}>
            <SpecStateContext.Provider value={specStateValue}>{children}</SpecStateContext.Provider>
          </DelegationStateContext.Provider>
        </TasksStateContext.Provider>
      </ChecksStateContext.Provider>
    </WorkspaceStateContext.Provider>
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

export type { RepoSettingsInput };
