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
  const label = isSwitchingWorkspace ? "Switching repository..." : "Loading tasks...";

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden px-1"
      data-testid="kanban-loading-overlay"
    >
      <div className="flex h-full min-h-0 flex-col">
        <output
          aria-live="polite"
          className="ml-3 mt-2 inline-flex items-center gap-2 self-start rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm"
        >
          <LoaderCircle className="size-3.5 animate-spin text-primary" />
          {label}
        </output>

        <div className="mt-4 flex min-h-0 min-w-max flex-1 items-stretch gap-4 pr-4">
          {LOADING_LANE_PREVIEW_IDS.map((previewId) => (
            <div
              key={previewId}
              className="flex w-[328px] min-w-[328px] flex-col overflow-hidden rounded-2xl border border-border bg-muted/45 shadow-sm"
            >
              <div className="space-y-3 border-b border-border/80 px-4 pb-3 pt-4">
                <div className="h-1.5 w-14 rounded-full bg-muted-foreground/15" />
                <div className="flex items-center justify-between gap-3">
                  <div className="h-3 w-24 rounded-full bg-muted-foreground/18" />
                  <div className="h-5 w-14 rounded-full bg-muted-foreground/12" />
                </div>
              </div>

              <div className="space-y-3 p-3">
                <div className="rounded-2xl border border-border/80 bg-card/75 p-3.5">
                  <div className="h-3 w-4/5 rounded-full bg-muted-foreground/14" />
                  <div className="mt-2 h-2.5 w-3/5 rounded-full bg-muted-foreground/10" />
                  <div className="mt-4 flex gap-2">
                    <div className="h-6 w-16 rounded-full bg-muted-foreground/10" />
                    <div className="h-6 w-12 rounded-full bg-muted-foreground/8" />
                  </div>
                  <div className="mt-4 h-9 rounded-xl bg-muted-foreground/8" />
                </div>

                <div className="rounded-2xl border border-border/70 bg-card/60 p-3.5">
                  <div className="h-3 w-3/4 rounded-full bg-muted-foreground/12" />
                  <div className="mt-2 h-2.5 w-1/2 rounded-full bg-muted-foreground/9" />
                  <div className="mt-4 h-9 rounded-xl bg-muted-foreground/7" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        {label}
      </div>
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
          "hide-scrollbar h-full w-full max-w-full overflow-x-auto overflow-y-hidden transition-opacity duration-150",
          showBlockingLoader ? "opacity-0" : "opacity-100",
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
