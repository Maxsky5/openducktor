import { optionalWorkspaceWorkflowQueryOptions } from "../../queries/workflows";
import { type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import {
  TASK_OPEN_STATE,
  type AgentSessionRecord,
  DEFAULT_KANBAN_SETTINGS,
  type WorkflowIcon,
  type IssueType,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { TasksStateContext, useRequiredContext } from "../../app-state/app-state-contexts";
import { useAgentSessionLists } from "../../queries/use-agent-session-lists";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";
import { isKanbanForegroundLoading } from "./kanban-board-loading";
import { useKanbanBoardFilterModel } from "./use-kanban-board-filter-model";

const NO_TASKS: TaskCard[] = [];

/** A board with tasks of several workflows. Each column names the workflows that use it. */
export type MixedBoard = {
  /** The workflow names of each column, by state ID. */
  readonly columnWorkflows: ReadonlyMap<string, readonly string[]>;
};
const NO_SESSIONS: AgentSessionRecord[] = [];

/**
 * The data of the Kanban board of the selected workspace: the host settings, the tasks, the
 * search and filters, and the saved sessions of each task. A failed settings read hides the
 * tasks, because the board cannot apply the Kanban settings without it.
 */
export function useKanbanBoardData({
  workspaceId,
  repoPath,
}: {
  workspaceId: string | null;
  repoPath: string | null;
}) {
  const queryClient = useQueryClient();
  const { tasks, isForegroundLoadingTasks } = useRequiredContext(
    TasksStateContext,
    "useKanbanBoardData",
  );
  const workflowQuery = useQuery(
    optionalWorkspaceWorkflowQueryOptions(
      workspaceId && repoPath ? { workspaceId, repoPath } : null,
    ),
  );
  const settingsQuery = useQuery(settingsSnapshotQueryOptions());
  const workspace = workflowQuery.data;
  const workflowError = workflowQuery.error;
  const kanbanTasks =
    repoPath && workspace && !workflowError && !settingsQuery.isError ? tasks : NO_TASKS;
  const taskIds = useMemo(() => kanbanTasks.map((task) => task.id), [kanbanTasks]);
  const mixedBoard = useMemo((): MixedBoard | null => {
    if (!workspace) return null;
    const workflowIds = new Set(kanbanTasks.map((task) => task.workflow.id));
    if (workflowIds.size <= 1) return null;
    // The enabled workflows, then the workflows of tasks that a repository no longer enables.
    const definitions = new Map(
      [
        ...workspace.workflows.map(({ definition }) => definition),
        ...kanbanTasks.map((task) => task.taskWorkflow.definition),
      ].map((definition) => [definition.id, definition]),
    );
    const columnWorkflows = new Map<string, string[]>();
    for (const definition of definitions.values())
      for (const state of definition.states)
        columnWorkflows.set(state.id, [...(columnWorkflows.get(state.id) ?? []), definition.label]);
    return { columnWorkflows };
  }, [kanbanTasks, workspace]);
  const issueTypeOptions = useMemo(() => {
    const options = new Map<
      IssueType,
      { value: IssueType; label: string; icon?: WorkflowIcon | undefined }
    >();
    for (const workflow of workspace?.workflows ?? []) {
      for (const type of workflow.definition.issueTypes) {
        const prior = options.get(type.id);
        options.set(type.id, {
          value: type.id,
          label:
            prior && prior.label !== type.label ? `${prior.label} / ${type.label}` : type.label,
          icon: type.icon,
        });
      }
    }
    return [...options.values()];
  }, [workspace]);
  const { filter, matchingTasks } = useKanbanBoardFilterModel(
    workspaceId,
    kanbanTasks,
    issueTypeOptions,
  );
  const sessionLists = useAgentSessionLists({
    workspaceId,
    repoPath,
    taskIds,
    enabled: repoPath !== null && taskIds.length > 0,
    queryClient,
  });
  const historicalSessionsByTaskId = useMemo(
    () => new Map(taskIds.map((taskId) => [taskId, sessionLists.data[taskId] ?? NO_SESSIONS])),
    [sessionLists.data, taskIds],
  );
  const isLoadingTasks =
    !workflowError &&
    isKanbanForegroundLoading({
      hasActiveWorkspace: repoPath !== null,
      isForegroundLoadingTasks,
      isSettingsPending: settingsQuery.isPending || workflowQuery.isPending,
      doneVisibleDays: settingsQuery.data?.kanban.doneVisibleDays,
      isKanbanPending: false,
    });
  return {
    workflowQuery,
    workflowError,
    boardDefinition: workflowError ? undefined : workspace?.context.board,
    creationStateId: workflowError || !workspace ? null : TASK_OPEN_STATE,
    settingsQuery,
    emptyColumnDisplay:
      settingsQuery.data?.kanban.emptyColumnDisplay ?? DEFAULT_KANBAN_SETTINGS.emptyColumnDisplay,
    /** The tasks of the board before the search and filters. */
    kanbanTasks,
    filter,
    /** The tasks that the search and filters keep. */
    matchingTasks,
    mixedBoard,
    historicalSessionsByTaskId,
    historicalSessionsError: sessionLists.error,
    isLoadingTasks,
  };
}
