import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildTasksStateValue } from "../app-state-context-values";
import {
  TaskOperationsContext,
  type TaskOperationsContextValue,
  TasksStateContext,
  useActiveRepoContext,
  useChecksOperationsContext,
} from "../app-state-contexts";
import { useTaskOperations } from "../operations";

export function TasksStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeRepo } = useActiveRepoContext();
  const { refreshBeadsCheckForRepo } = useChecksOperationsContext();
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

  const tasksStateValue = useMemo(
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

  const taskOperationsValue = useMemo<TaskOperationsContextValue>(
    () => ({
      tasks,
      runs,
      refreshTaskData,
      clearTaskData,
      setIsLoadingTasks,
    }),
    [clearTaskData, refreshTaskData, runs, setIsLoadingTasks, tasks],
  );

  return (
    <TaskOperationsContext.Provider value={taskOperationsValue}>
      <TasksStateContext.Provider value={tasksStateValue}>{children}</TasksStateContext.Provider>
    </TaskOperationsContext.Provider>
  );
}
