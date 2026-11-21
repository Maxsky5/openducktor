import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

function Bar({ className }: { className: string }): ReactElement {
  return <div className={cn("rounded-md bg-muted", className)} />;
}

/** One section of the element list: its tile, its title, and a few rows. */
function SectionSkeleton({ rows }: { rows: number }): ReactElement {
  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-2.5">
        <Bar className="size-6 rounded-md" />
        <Bar className="h-3.5 w-20" />
      </div>
      <div className="ml-[18px] flex flex-col gap-2.5 border-l border-border/70 py-1 pl-3">
        {Array.from({ length: rows }, (_, row) => (
          <Bar key={row} className={cn("h-3", row % 2 === 0 ? "w-28" : "w-36")} />
        ))}
      </div>
    </div>
  );
}

/** A state box of the canvas. */
function BoxSkeleton({ className }: { className?: string }): ReactElement {
  return (
    <div
      className={cn(
        "flex h-[54px] w-[190px] items-center gap-3 rounded-xl border border-border bg-card px-3",
        className,
      )}
    >
      <Bar className="size-8 rounded-lg" />
      <div className="flex flex-col gap-1.5">
        <Bar className="h-3 w-20" />
        <Bar className="h-2.5 w-14" />
      </div>
    </div>
  );
}

/**
 * The editor while its code or its workflow loads: the top bar, the element list, and the canvas
 * in their places, so the page does not jump when the editor shows.
 */
export function EditorSkeleton(): ReactElement {
  return (
    <div
      role="status"
      aria-label="Opening the workflow"
      className="flex h-full min-h-0 flex-col animate-pulse"
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <Bar className="h-3.5 w-20" />
        <Bar className="h-4 w-36" />
        <Bar className="ml-auto h-8 w-24 rounded-lg" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[272px] shrink-0 flex-col gap-1 border-r border-border bg-sidebar py-2">
          <Bar className="mx-3 mb-2 h-8" />
          <SectionSkeleton rows={4} />
          <SectionSkeleton rows={3} />
          <SectionSkeleton rows={2} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-16 pt-16">
          <BoxSkeleton />
          <BoxSkeleton />
          <BoxSkeleton />
        </div>
      </div>
    </div>
  );
}
