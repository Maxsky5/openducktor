import type { ReactElement } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

/** The loading or error content inside `TaskDetailsSheetFrame`. */
export function TaskDetailsSheetPlaceholder({
  onOpenChange,
  error,
}: {
  onOpenChange: (open: boolean) => void;
  error?: string;
}): ReactElement {
  return (
    <>
      <SheetTitle className="sr-only">Task Details</SheetTitle>
      <SheetDescription className="sr-only">Inspect task details.</SheetDescription>
      {error ? (
        <>
          <SheetHeader className="border-b border-border bg-card px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">Task details</h2>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 overflow-y-auto px-5 py-6">
            <div
              role="alert"
              className="m-auto flex w-full max-w-md flex-col items-center rounded-xl border border-destructive-border bg-destructive-surface px-6 py-8 text-center"
            >
              <div className="mb-4 flex size-12 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive-muted">
                <CircleAlert aria-hidden="true" className="size-6" />
              </div>
              <div className="min-w-0 w-full">
                <h3 className="text-base font-semibold leading-6 text-destructive-surface-foreground">
                  Task details unavailable
                </h3>
                <p className="mt-2 break-words text-sm leading-6 text-destructive-surface-foreground">
                  {error}
                </p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div
          role="status"
          aria-label="Loading task details"
          aria-busy="true"
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetHeader className="border-b border-border bg-card px-5 py-4">
            <div aria-hidden="true" className="flex flex-col gap-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-28" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-5 w-28" />
              </div>
            </div>
          </SheetHeader>
          <div
            aria-hidden="true"
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
          >
            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            {["spec", "plan", "qa"].map((section) => (
              <div key={section} className="rounded-lg border border-border p-4">
                <Skeleton className="h-4 w-36" />
              </div>
            ))}
            <Skeleton className="mt-1 h-4 w-48" />
          </div>
        </div>
      )}
      <div className="flex justify-end border-t border-border bg-card px-5 py-3">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    </>
  );
}
