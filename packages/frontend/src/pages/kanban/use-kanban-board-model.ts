import type {
  AgentSessionRecord,
  KanbanEmptyColumnDisplay,
  KanbanTaskCardView,
} from "@openducktor/contracts";
import type {
  BuiltinRoleId as AgentRole,
  BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import type {
  ActiveTaskSessionContext,
  KanbanTaskSession,
} from "@openducktor/frontend-core/tasks/board/kanban-task-activity";
import type { SessionTargetOptions } from "@openducktor/frontend-core/tasks/board/session-target-resolution";
import { useKanbanBoardColumns } from "@openducktor/frontend-core/tasks/board/use-kanban-board-columns";
import type { WorkflowPendingState } from "@openducktor/frontend-core/tasks/board/kanban-task-footer";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

type UseKanbanBoardModelArgs = {
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
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  activeTaskSessionContextByTaskId: Map<string, ActiveTaskSessionContext>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onResetImplementation: (taskId: string) => void;
};

export function useKanbanBoardModel({
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
  taskSessionsByTaskId,
  activeTaskSessionContextByTaskId,
  onOpenDetails,
  onDelegate,
  onOpenSession,
  onPlan,
  onQaStart,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
}: UseKanbanBoardModelArgs): KanbanPageContentModel {
  const { columns, taskActivityStateByTaskId } = useKanbanBoardColumns(tasks, taskSessionsByTaskId);

  return {
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
    activeTaskSessionContextByTaskId,
    taskActivityStateByTaskId,
    onOpenDetails,
    onDelegate,
    onOpenSession,
    onPlan,
    onQaStart,
    onHumanApprove,
    onHumanRequestChanges,
    onResetImplementation,
  };
}
