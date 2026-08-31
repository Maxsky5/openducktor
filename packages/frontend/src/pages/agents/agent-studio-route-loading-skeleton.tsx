import type { ReactElement } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function AgentStudioRouteLoadingSkeleton(): ReactElement {
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-card"
      role="status"
      aria-label="Loading Agent Studio"
      aria-busy="true"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="ml-auto size-8" />
      </div>
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col border-r border-border">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
            <Skeleton className="size-9" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-between gap-6 p-4">
            <div className="space-y-4">
              <Skeleton className="h-20 w-4/5" />
              <Skeleton className="ml-auto h-16 w-3/5" />
              <Skeleton className="h-24 w-4/5" />
            </div>
            <Skeleton className="h-24 w-full" />
          </div>
        </section>
        <aside className="hidden w-[37%] min-w-72 flex-col lg:flex">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="ml-auto size-7" />
          </div>
          <div className="grid gap-3 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </aside>
      </div>
    </div>
  );
}
