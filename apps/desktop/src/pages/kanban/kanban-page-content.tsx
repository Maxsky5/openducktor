import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { KanbanColumn } from "@/components/features/kanban";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

type KanbanPageContentProps = {
  model: KanbanPageContentModel;
};

const LOADING_LANE_PREVIEWS = [
  {
    id: "backlog",
    accentClass: "bg-muted-foreground/25",
    surfaceClass: "border-border/90 bg-muted/70 dark:border-border dark:bg-muted/45",
    headerClass: "border-border/80",
  },
  {
    id: "spec",
    accentClass: "bg-violet-400/80 dark:bg-violet-500/70",
    surfaceClass:
      "border-violet-300/85 dark:border-violet-800/50 bg-violet-100/55 dark:bg-violet-950/20",
    headerClass: "border-violet-300/75 dark:border-violet-800/40",
  },
  {
    id: "ready",
    accentClass: "bg-sky-400/80 dark:bg-sky-500/70",
    surfaceClass: "border-sky-300/85 dark:border-sky-800/50 bg-sky-100/55 dark:bg-sky-950/20",
    headerClass: "border-sky-300/75 dark:border-sky-800/40",
  },
  {
    id: "build",
    accentClass: "bg-amber-400/80 dark:bg-amber-500/70",
    surfaceClass:
      "border-amber-300/85 dark:border-amber-800/50 bg-amber-100/60 dark:bg-amber-950/20",
    headerClass: "border-amber-300/75 dark:border-amber-800/40",
  },
  {
    id: "review",
    accentClass: "bg-indigo-400/80 dark:bg-indigo-500/70",
    surfaceClass:
      "border-indigo-300/85 dark:border-indigo-800/50 bg-indigo-100/55 dark:bg-indigo-950/20",
    headerClass: "border-indigo-300/75 dark:border-indigo-800/40",
  },
] as const;

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
        <div className="flex min-h-0 min-w-max flex-1 items-stretch gap-4 pr-4">
          {LOADING_LANE_PREVIEWS.map((preview) => (
            <div
              key={preview.id}
              data-testid="kanban-loading-lane"
              className={cn(
                "flex w-[328px] min-w-[328px] flex-col overflow-hidden rounded-2xl shadow-sm",
                preview.surfaceClass,
              )}
            >
              <div className={cn("space-y-3 border-b px-4 pb-3 pt-4", preview.headerClass)}>
                <Skeleton className={cn("h-1.5 w-14 rounded-full", preview.accentClass)} />
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3 w-24 rounded-full bg-foreground/12 dark:bg-foreground/18" />
                  <Skeleton className="h-5 w-14 rounded-full bg-foreground/10 dark:bg-foreground/14" />
                </div>
              </div>

              <div className="space-y-3 p-3">
                <div className="rounded-2xl border border-border/85 bg-card/88 dark:border-border/80 dark:bg-card/75 p-3.5">
                  <Skeleton className="h-3 w-4/5 rounded-full bg-foreground/11 dark:bg-foreground/14" />
                  <Skeleton className="mt-2 h-2.5 w-3/5 rounded-full bg-foreground/9 dark:bg-foreground/10" />
                  <div className="mt-4 flex gap-2">
                    <Skeleton className="h-6 w-16 rounded-full bg-foreground/9 dark:bg-foreground/10" />
                    <Skeleton className="h-6 w-12 rounded-full bg-foreground/8 dark:bg-foreground/8" />
                  </div>
                  <Skeleton className="mt-4 h-9 rounded-xl bg-foreground/8 dark:bg-foreground/8" />
                </div>

                <div className="rounded-2xl border border-border/80 bg-card/80 dark:border-border/70 dark:bg-card/60 p-3.5">
                  <Skeleton className="h-3 w-3/4 rounded-full bg-foreground/10 dark:bg-foreground/12" />
                  <Skeleton className="mt-2 h-2.5 w-1/2 rounded-full bg-foreground/8 dark:bg-foreground/9" />
                  <Skeleton className="mt-4 h-9 rounded-xl bg-foreground/7 dark:bg-foreground/7" />
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
