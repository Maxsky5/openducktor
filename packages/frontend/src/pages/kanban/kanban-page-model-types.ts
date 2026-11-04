import type {
  AgentSessionRecord,
  KanbanEmptyColumnDisplay,
  KanbanTaskCardView,
} from "@openducktor/contracts";
import type { KanbanColumn as KanbanColumnData } from "@openducktor/workflows";
import type { ComponentProps } from "react";
import type { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@openducktor/frontend-core/tasks/board/kanban-task-activity";
import type { WorkflowPendingState } from "@openducktor/frontend-core/tasks/board/kanban-task-footer";
import type { SessionStartFlowRequest } from "@openducktor/frontend-core/sessions/start/session-start-orchestration";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { KanbanBoardFilterModel } from "@openducktor/frontend-core/tasks/board/use-kanban-board-filter-model";

export type KanbanSessionStartIntent = SessionStartFlowRequest;

export type KanbanPageHeaderModel = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  taskCardView: KanbanTaskCardView | null;
  isTaskCardViewPending: boolean;
  onTaskCardViewChange: (taskCardView: KanbanTaskCardView) => void;
  onRefreshTasks: () => void;
  filter: KanbanBoardFilterModel;
};

export type KanbanPageContentModel = {
  loadError?: string | null;
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  emptyColumnDisplay: KanbanEmptyColumnDisplay;
  taskCardView: KanbanTaskCardView;
  pendingState?: WorkflowPendingState | undefined;
  showHorizontalScrollbars: boolean | null;
  columns: KanbanColumnData[];
  /** The board loaded at least one task, also when the search and filters hide it. */
  hasLoadedTasks: boolean;
  filter: Pick<KanbanBoardFilterModel, "isActive" | "onClear">;
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  historicalSessionsByTaskId: Map<string, AgentSessionRecord[]>;
  /** The target of each task whose branch is merged. Its card proposes Close Task. */
  mergedTargetByTaskId: ReadonlyMap<string, string>;
  /** Why the pull request sync could not close each task. */
  autoCloseFailureByTaskId: ReadonlyMap<string, string>;
  activeTaskSessionContextByTaskId: ActiveTaskSessionContextByTaskId;
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>;
  onOpenDetails: (taskId: string) => void;
};

export type KanbanPageModels = {
  header: KanbanPageHeaderModel;
  content: KanbanPageContentModel;
  activeWorkspace: ActiveWorkspace | null;
  mergedPullRequestModal: ComponentProps<typeof MergedPullRequestConfirmDialog> | null;
};
