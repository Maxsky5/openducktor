import type {
  AgentSessionRecord,
  KanbanEmptyColumnDisplay,
  KanbanTaskCardView,
} from "@openducktor/contracts";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import type {
  ActiveTaskSessionContext,
  KanbanTaskSession,
} from "@openducktor/frontend-core/tasks/board/kanban-task-activity";
import { useKanbanBoardColumns } from "@openducktor/frontend-core/tasks/board/use-kanban-board-columns";
import type { WorkflowPendingState } from "@openducktor/frontend-core/tasks/board/kanban-task-footer";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

type UseKanbanBoardModelArgs = {
  boardDefinition: import("@openducktor/contracts").WorkflowBoardDefinition | undefined;
  loadError?: string | null;
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  emptyColumnDisplay: KanbanEmptyColumnDisplay;
  taskCardView: KanbanTaskCardView;
  pendingState?: WorkflowPendingState | undefined;
  showHorizontalScrollbars: boolean | null;
  /** The tasks that the search and filters show. */
  tasks: TaskCard[];
  hasLoadedTasks: boolean;
  filter: KanbanPageContentModel["filter"];
  historicalSessionsByTaskId: Map<string, AgentSessionRecord[]>;
  /** The target of each task whose branch is merged. */
  mergedTargetByTaskId: ReadonlyMap<string, string>;
  /** Why the pull request sync could not close each task. */
  autoCloseFailureByTaskId: ReadonlyMap<string, string>;
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  activeTaskSessionContextByTaskId: Map<string, ActiveTaskSessionContext>;
  onOpenDetails: (taskId: string) => void;
};

export function useKanbanBoardModel({
  boardDefinition,
  loadError = null,
  isLoadingTasks,
  isSwitchingWorkspace,
  emptyColumnDisplay,
  taskCardView,
  pendingState,
  showHorizontalScrollbars,
  tasks,
  hasLoadedTasks,
  filter,
  historicalSessionsByTaskId,
  mergedTargetByTaskId,
  autoCloseFailureByTaskId,
  taskSessionsByTaskId,
  activeTaskSessionContextByTaskId,
  onOpenDetails,
}: UseKanbanBoardModelArgs): KanbanPageContentModel {
  const { columns, taskActivityStateByTaskId } = useKanbanBoardColumns(
    tasks,
    taskSessionsByTaskId,
    boardDefinition,
  );

  return {
    loadError,
    isLoadingTasks,
    isSwitchingWorkspace,
    emptyColumnDisplay,
    taskCardView,
    pendingState,
    showHorizontalScrollbars,
    columns,
    hasLoadedTasks,
    filter,
    taskSessionsByTaskId,
    historicalSessionsByTaskId,
    mergedTargetByTaskId,
    autoCloseFailureByTaskId,
    activeTaskSessionContextByTaskId,
    taskActivityStateByTaskId,
    onOpenDetails,
  };
}
