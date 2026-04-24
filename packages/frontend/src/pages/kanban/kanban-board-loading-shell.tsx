import type { KanbanColumnId } from "@openducktor/core";
import type { ReactElement } from "react";
import { KANBAN_LANE_WIDTH_CLASS } from "@/components/features/kanban/kanban-layout";
import { laneTheme } from "@/components/features/kanban/kanban-theme";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const LOADING_LANE_PREVIEW_IDS: KanbanColumnId[] = [
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
  "closed",
];

const LOADING_LANE_PREVIEWS = LOADING_LANE_PREVIEW_IDS.map((id) => {
  const theme = laneTheme(id);
  return {
    id,
    accentClass: theme.headerAccentClass,
    surfaceClass: theme.boardSurfaceClass,
    headerClass: theme.headerSurfaceClass,
  };
});

export function KanbanBoardLoadingShell({
  label,
  testId,
}: {
  label: string;
  testId: string;
}): ReactElement {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden px-1"
      data-testid={testId}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 min-w-max flex-1 items-stretch gap-4 pr-4">
          {LOADING_LANE_PREVIEWS.map((preview) => (
            <div
              key={preview.id}
              data-testid="kanban-loading-lane"
              className={cn(
                "flex flex-col overflow-hidden rounded-2xl shadow-sm",
                KANBAN_LANE_WIDTH_CLASS,
                preview.surfaceClass,
              )}
            >
              <div
                className={cn(
                  "space-y-3 border-b border-border/80 px-4 pb-3 pt-4",
                  preview.headerClass,
                )}
              >
                <Skeleton className={cn("h-1.5 w-14 rounded-full", preview.accentClass)} />
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3 w-24 rounded-full bg-foreground/12 dark:bg-foreground/18" />
                  <Skeleton className="h-5 w-14 rounded-full bg-foreground/10 dark:bg-foreground/14" />
                </div>
              </div>

              <div className="space-y-3 p-3">
                <div className="rounded-2xl border border-border/85 bg-card/88 p-3.5 dark:border-border/80 dark:bg-card/75">
                  <Skeleton className="h-3 w-4/5 rounded-full bg-foreground/11 dark:bg-foreground/14" />
                  <Skeleton className="mt-2 h-2.5 w-3/5 rounded-full bg-foreground/9 dark:bg-foreground/10" />
                  <div className="mt-4 flex gap-2">
                    <Skeleton className="h-6 w-16 rounded-full bg-foreground/9 dark:bg-foreground/10" />
                    <Skeleton className="h-6 w-12 rounded-full bg-foreground/8 dark:bg-foreground/8" />
                  </div>
                  <Skeleton className="mt-4 h-9 rounded-xl bg-foreground/8 dark:bg-foreground/8" />
                </div>

                <div className="rounded-2xl border border-border/80 bg-card/80 p-3.5 dark:border-border/70 dark:bg-card/60">
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
