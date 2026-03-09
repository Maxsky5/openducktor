import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { KanbanColumn } from "@/components/features/kanban";
import { cn } from "@/lib/utils";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

type KanbanPageContentProps = {
  model: KanbanPageContentModel;
};

const LOADING_LANE_PREVIEW_IDS = ["backlog", "build", "review"] as const;

function KanbanBoardLoadingOverlay({
  isSwitchingWorkspace,
}: {
  isSwitchingWorkspace: boolean;
}): ReactElement {
  const title = isSwitchingWorkspace ? "Switching repository" : "Loading Kanban tasks";
  const description = isSwitchingWorkspace
    ? "Preparing the selected repository and loading its task board."
    : "Reading the Beads task store and preparing the board.";

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center px-4 pb-6"
      data-testid="kanban-loading-overlay"
    >
      <output
        aria-live="polite"
        className="w-full max-w-3xl rounded-[1.75rem] border border-border bg-card/95 p-5 shadow-xl shadow-foreground/5 backdrop-blur-sm"
      >
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/70">
            <LoaderCircle className="size-5 animate-spin text-primary" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {LOADING_LANE_PREVIEW_IDS.map((previewId) => (
            <div
              key={previewId}
              className="rounded-2xl border border-border bg-muted/55 p-3 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="h-2.5 w-16 rounded-full bg-muted-foreground/20" />
                <div className="h-5 w-14 rounded-full bg-muted-foreground/15" />
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-border/80 bg-card/80 p-3">
                  <div className="h-2.5 w-4/5 rounded-full bg-muted-foreground/15" />
                  <div className="mt-2 h-2.5 w-3/5 rounded-full bg-muted-foreground/10" />
                </div>
                <div className="rounded-xl border border-border/70 bg-card/60 p-3">
                  <div className="h-2.5 w-3/4 rounded-full bg-muted-foreground/15" />
                  <div className="mt-2 h-2.5 w-1/2 rounded-full bg-muted-foreground/10" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </output>
    </div>
  );
}

function KanbanBoardRefreshingIndicator(): ReactElement {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-2"
      data-testid="kanban-refresh-indicator"
    >
      <output
        aria-live="polite"
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm"
      >
        <LoaderCircle className="size-3.5 animate-spin text-primary" />
        Refreshing tasks...
      </output>
    </div>
  );
}

export function KanbanPageContent({ model }: KanbanPageContentProps): ReactElement {
  const totalTaskCount = model.columns.reduce((count, column) => count + column.tasks.length, 0);
  const isBoardLoading = model.isLoadingTasks || model.isSwitchingWorkspace;
  const showBlockingLoader = isBoardLoading && totalTaskCount === 0;
  const showRefreshingIndicator =
    model.isLoadingTasks && !model.isSwitchingWorkspace && totalTaskCount > 0;

  return (
    <section
      className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden"
      aria-busy={isBoardLoading}
    >
      {showRefreshingIndicator ? <KanbanBoardRefreshingIndicator /> : null}

      <div
        className={cn(
          "hide-scrollbar h-full w-full max-w-full overflow-x-auto overflow-y-hidden transition-opacity duration-200",
          showBlockingLoader ? "opacity-35" : "opacity-100",
        )}
      >
        <div className="flex min-h-full min-w-max items-start gap-4 pr-4">
          {model.columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              runStateByTaskId={model.runStateByTaskId}
              activeSessionsByTaskId={model.activeSessionsByTaskId}
              onOpenDetails={model.onOpenDetails}
              onDelegate={model.onDelegate}
              onPlan={model.onPlan}
              onBuild={model.onBuild}
              onHumanApprove={model.onHumanApprove}
              onHumanRequestChanges={model.onHumanRequestChanges}
            />
          ))}
        </div>
      </div>

      {showBlockingLoader ? (
        <KanbanBoardLoadingOverlay isSwitchingWorkspace={model.isSwitchingWorkspace} />
      ) : null}
    </section>
  );
}
