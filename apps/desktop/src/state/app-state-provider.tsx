import type { RunEvent } from "@openducktor/contracts";
import {
  type Context,
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useContext,
  useMemo,
  useState,
} from "react";
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
  buildAgentStateValue,
  buildChecksStateValue,
  buildDelegationStateValue,
  buildSpecStateValue,
  buildTasksStateValue,
  buildWorkspaceStateValue,
  findActiveWorkspace,
} from "./app-state-context-values";
import { useAppLifecycle } from "./lifecycle/use-app-lifecycle";
import { useAgentOrchestratorOperations } from "./operations/use-agent-orchestrator-operations";
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
const AgentStateContext = createContext<AgentStateContextValue | null>(null);

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
    activeRepoOpencodeHealth,
    isLoadingChecks,
    setIsLoadingChecks,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRepoOpencodeHealthForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    hasCachedRepoOpencodeHealth,
    clearActiveBeadsCheck,
    clearActiveRepoOpencodeHealth,
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
    deleteTask,
    transitionTask,
    deferTask,
    resumeDeferredTask,
    humanApproveTask,
    humanRequestChangesTask,
  } = useTaskOperations({
    activeRepo,
    refreshBeadsCheckForRepo,
  });

  const { delegateTask, delegateRespond, delegateStop, delegateCleanup } = useDelegationOperations({
    activeRepo,
    refreshTaskData,
  });

  const {
    loadSpec,
    loadSpecDocument,
    loadPlanDocument,
    loadQaReportDocument,
    saveSpec,
    saveSpecDocument,
    savePlanDocument,
  } = useSpecOperations({
    activeRepo,
  });

  const {
    sessions,
    loadAgentSessions,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  } = useAgentOrchestratorOperations({
    activeRepo,
    tasks,
    runs,
    refreshTaskData,
  });

  const {
    workspaces,
    branches,
    activeBranch,
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
    refreshBranches,
    switchBranch,
    clearBranchData,
  } = useWorkspaceOperations({
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
    refreshBranches,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRepoOpencodeHealthForRepo,
    refreshTaskData,
    clearTaskData,
    clearBranchData,
    clearActiveBeadsCheck,
    clearActiveRepoOpencodeHealth,
    setIsLoadingChecks,
    setIsLoadingTasks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    hasCachedRepoOpencodeHealth,
  });

  const activeWorkspace = useMemo(
    () => findActiveWorkspace(workspaces, activeRepo),
    [activeRepo, workspaces],
  );

  const workspaceStateValue = useMemo<WorkspaceStateContextValue>(
    () =>
      buildWorkspaceStateValue({
        isSwitchingWorkspace,
        isLoadingBranches,
        isSwitchingBranch,
        workspaces,
        activeRepo,
        activeWorkspace,
        branches,
        activeBranch,
        addWorkspace,
        selectWorkspace,
        refreshBranches,
        switchBranch,
        loadRepoSettings,
        saveRepoSettings,
      }),
    [
      activeRepo,
      activeBranch,
      activeWorkspace,
      addWorkspace,
      branches,
      isLoadingBranches,
      isSwitchingBranch,
      isSwitchingWorkspace,
      loadRepoSettings,
      refreshBranches,
      saveRepoSettings,
      selectWorkspace,
      switchBranch,
      workspaces,
    ],
  );

  const checksStateValue = useMemo<ChecksStateContextValue>(
    () =>
      buildChecksStateValue({
        runtimeCheck,
        beadsCheck: activeBeadsCheck,
        opencodeHealth: activeRepoOpencodeHealth,
        isLoadingChecks,
        refreshChecks,
      }),
    [activeBeadsCheck, activeRepoOpencodeHealth, isLoadingChecks, refreshChecks, runtimeCheck],
  );

  const tasksStateValue = useMemo<TasksStateContextValue>(
    () =>
      buildTasksStateValue({
        isLoadingTasks,
        tasks,
        runs,
        refreshTasks,
        createTask,
        updateTask,
        deleteTask,
        transitionTask,
        deferTask,
        resumeDeferredTask,
        humanApproveTask,
        humanRequestChangesTask,
      }),
    [
      createTask,
      deleteTask,
      deferTask,
      humanApproveTask,
      humanRequestChangesTask,
      isLoadingTasks,
      refreshTasks,
      resumeDeferredTask,
      runs,
      tasks,
      transitionTask,
      updateTask,
    ],
  );

  const delegationStateValue = useMemo<DelegationStateContextValue>(
    () =>
      buildDelegationStateValue({
        events,
        delegateTask,
        delegateRespond,
        delegateStop,
        delegateCleanup,
      }),
    [delegateCleanup, delegateRespond, delegateStop, delegateTask, events],
  );

  const specStateValue = useMemo<SpecStateContextValue>(
    () =>
      buildSpecStateValue({
        loadSpec,
        loadSpecDocument,
        loadPlanDocument,
        loadQaReportDocument,
        saveSpec,
        saveSpecDocument,
        savePlanDocument,
      }),
    [
      loadPlanDocument,
      loadQaReportDocument,
      loadSpec,
      loadSpecDocument,
      saveSpec,
      saveSpecDocument,
      savePlanDocument,
    ],
  );

  const agentStateValue = useMemo<AgentStateContextValue>(
    () =>
      buildAgentStateValue({
        sessions,
        loadAgentSessions,
        startAgentSession,
        sendAgentMessage,
        stopAgentSession,
        updateAgentSessionModel,
        replyAgentPermission,
        answerAgentQuestion,
      }),
    [
      answerAgentQuestion,
      loadAgentSessions,
      replyAgentPermission,
      sendAgentMessage,
      sessions,
      startAgentSession,
      stopAgentSession,
      updateAgentSessionModel,
    ],
  );

  return (
    <WorkspaceStateContext.Provider value={workspaceStateValue}>
      <ChecksStateContext.Provider value={checksStateValue}>
        <TasksStateContext.Provider value={tasksStateValue}>
          <DelegationStateContext.Provider value={delegationStateValue}>
            <SpecStateContext.Provider value={specStateValue}>
              <AgentStateContext.Provider value={agentStateValue}>
                {children}
              </AgentStateContext.Provider>
            </SpecStateContext.Provider>
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

export const useAgentState = (): AgentStateContextValue =>
  useRequiredContext(AgentStateContext, "useAgentState");

export type { RepoSettingsInput };
