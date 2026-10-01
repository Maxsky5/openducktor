import {
  type FocusEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { KanbanCollapsedColumn } from "@/components/features/kanban/kanban-collapsed-column";
import { KanbanColumn } from "@/components/features/kanban/kanban-column";
import {
  focusCardControl,
  getControlKey,
  hasLostFocus,
} from "@/components/features/kanban/use-kanban-card-focus";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { KanbanBoardLoadingShell } from "./kanban-board-loading-shell";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

type KanbanPageContentProps = {
  model: KanbanPageContentModel;
};

export function KanbanPageContent({ model }: KanbanPageContentProps): ReactElement {
  const boardRef = useRef<HTMLElement>(null);
  const focusRef = useRef<{
    element: HTMLElement;
    taskId: string;
    control: string;
  } | null>(null);
  const onFocusCapture = (event: FocusEvent<HTMLElement>): void => {
    const element = event.target;
    const taskId =
      element instanceof HTMLElement
        ? element.closest("[data-kanban-task-id]")?.getAttribute("data-kanban-task-id")
        : null;
    const control = element instanceof HTMLElement ? getControlKey(element) : null;
    focusRef.current =
      element instanceof HTMLElement && taskId && control ? { element, taskId, control } : null;
  };
  const repairFocus = useCallback(() => {
    const focused = focusRef.current;
    const board = boardRef.current;
    if (!focused || !board || !hasLostFocus(focused.element)) return;
    focusRef.current = null;
    const card = Array.from(
      board.querySelectorAll<HTMLElement>("article[data-kanban-task-id]"),
    ).find((element) => element.dataset.kanbanTaskId === focused.taskId);
    if (card) {
      focusCardControl(card, focused.control);
      return;
    }
    const destination = model.columns.find((column) =>
      column.tasks.some((task) => task.id === focused.taskId),
    );
    const lane = Array.from(board.querySelectorAll<HTMLElement>("[data-kanban-lane-id]")).find(
      (element) => element.dataset.kanbanLaneId === destination?.id,
    );
    (lane ?? board).focus();
  }, [model.columns]);
  useLayoutEffect(() => {
    repairFocus();
  });
  // Virtual scrolling can remove a card without rendering this board again.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const observer = new MutationObserver(repairFocus);
    observer.observe(board, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [repairFocus]);
  const totalTaskCount = model.columns.reduce((count, column) => count + column.tasks.length, 0);
  const isBoardLoading = model.isLoadingTasks || model.isSwitchingWorkspace;
  const showBlockingLoader = isBoardLoading && totalTaskCount === 0;

  return (
    <section
      ref={boardRef}
      tabIndex={-1}
      aria-label="Kanban board"
      onFocusCapture={onFocusCapture}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof HTMLElement &&
          !event.relatedTarget.closest("[data-kanban-task-id]")
        )
          focusRef.current = null;
      }}
      className="relative min-h-0 min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      aria-busy={isBoardLoading}
    >
      <div
        className={cn(
          "min-h-full w-full max-w-full overflow-x-auto overflow-y-visible transition-opacity duration-150",
          model.showHorizontalScrollbars === false && "hide-scrollbar",
          showBlockingLoader ? "opacity-0" : "opacity-100",
        )}
      >
        <TooltipProvider delayDuration={120}>
          <div className="flex min-h-full min-w-max items-start gap-4 pr-4">
            {model.columns.map((column) => renderColumn(column, model))}
          </div>
        </TooltipProvider>
      </div>

      {showBlockingLoader ? (
        <KanbanBoardLoadingShell
          label={model.isSwitchingWorkspace ? "Switching repository..." : "Loading tasks..."}
          testId="kanban-loading-overlay"
        />
      ) : null}
    </section>
  );
}

type Column = KanbanPageContentModel["columns"][number];

function renderColumn(column: Column, model: KanbanPageContentModel): ReactElement | null {
  if (column.tasks.length === 0 && model.emptyColumnDisplay === "hidden") {
    return null;
  }

  if (column.tasks.length === 0 && model.emptyColumnDisplay === "collapsed") {
    return <KanbanCollapsedColumn key={column.id} column={column} />;
  }

  return (
    <KanbanColumn
      key={column.id}
      column={column}
      taskCardView={model.taskCardView}
      pendingState={model.pendingState}
      taskSessionsByTaskId={model.taskSessionsByTaskId}
      historicalSessionsByTaskId={model.historicalSessionsByTaskId}
      activeTaskSessionContextByTaskId={model.activeTaskSessionContextByTaskId}
      taskActivityStateByTaskId={model.taskActivityStateByTaskId}
      onOpenDetails={model.onOpenDetails}
      onDelegate={model.onDelegate}
      onOpenSession={model.onOpenSession}
      onPlan={model.onPlan}
      onQaStart={model.onQaStart}
      onHumanApprove={model.onHumanApprove}
      onHumanRequestChanges={model.onHumanRequestChanges}
      onResetImplementation={model.onResetImplementation}
    />
  );
}
