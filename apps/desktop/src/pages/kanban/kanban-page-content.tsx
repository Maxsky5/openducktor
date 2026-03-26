import type { ReactElement } from "react";
import { KanbanColumn } from "@/components/features/kanban";
import { cn } from "@/lib/utils";
import { KanbanBoardLoadingShell } from "./kanban-board-loading-shell";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

type KanbanPageContentProps = {
  model: KanbanPageContentModel;
};

export function KanbanPageContent({ model }: KanbanPageContentProps): ReactElement {
  const totalTaskCount = model.columns.reduce((count, column) => count + column.tasks.length, 0);
  const isBoardLoading = model.isLoadingTasks || model.isSwitchingWorkspace;
  const showBlockingLoader = isBoardLoading && totalTaskCount === 0;

  return (
    <section className="relative min-h-0 min-w-0 flex-1" aria-busy={isBoardLoading}>
      <div
        className={cn(
          "hide-scrollbar min-h-full w-full max-w-full overflow-x-auto overflow-y-visible transition-opacity duration-150",
          showBlockingLoader ? "opacity-0" : "opacity-100",
        )}
      >
        <div className="flex min-h-full min-w-max items-start gap-4 pr-4">
          {model.columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              runStateByTaskId={model.runStateByTaskId}
              taskSessionsByTaskId={model.taskSessionsByTaskId}
              activeTaskSessionContextByTaskId={model.activeTaskSessionContextByTaskId}
              taskActivityStateByTaskId={model.taskActivityStateByTaskId}
              onOpenDetails={model.onOpenDetails}
              onDelegate={model.onDelegate}
              onOpenSession={model.onOpenSession}
              onPlan={model.onPlan}
              onQaStart={model.onQaStart}
              onQaOpen={model.onQaOpen}
              onBuild={model.onBuild}
              onHumanApprove={model.onHumanApprove}
              onHumanRequestChanges={model.onHumanRequestChanges}
              onResetImplementation={model.onResetImplementation}
            />
          ))}
        </div>
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
