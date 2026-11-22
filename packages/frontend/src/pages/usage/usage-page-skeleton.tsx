import type { ReactElement } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/** The page header while the page chunk loads: title, runtime menu, and filters. */
export function UsageHeaderSkeleton(): ReactElement {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3" aria-hidden="true">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3.5 w-52" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-80 rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
        <Skeleton className="size-9 rounded-lg" />
      </div>
    </div>
  );
}

/** The layout of a usage report while a slow read loads. */
export function UsagePageSkeleton(): ReactElement {
  return (
    // It appears after a moment, so a read that answers sooner never flashes it. A first read
    // shows its progress card instead.
    <div
      className="flex flex-col gap-12 motion-safe:animate-[usage-reveal_200ms_ease-out_300ms_both]"
      role="status"
    >
      <span className="sr-only">Loading usage</span>
      <div className="grid grid-cols-1 gap-x-12 gap-y-8 @4xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-7">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-12 w-40" />
            <Skeleton className="h-3.5 w-36" />
          </div>
          <div className="flex flex-col gap-5">
            {["first", "second", "third"].map((row) => (
              <div key={row} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="ml-4 h-3 w-40" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-[260px] w-full rounded-lg" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 @xl:grid-cols-4">
          {["reads", "writes", "input", "output"].map((type) => (
            <div key={type} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-52 rounded-lg" />
        </div>
        {["1", "2", "3", "4", "5"].map((row) => (
          <Skeleton key={row} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}
