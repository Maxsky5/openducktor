import { TASK_READS_LOADING_COPY as COPY } from "@openducktor/frontend-core/tasks/details/task-close-copy";
import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

/**
 * The one loader of a task confirmation. It shows until every read of the confirmation ends, so no
 * part of the content changes after it shows.
 */
export function TaskReadsLoading({ className }: { className?: string }): ReactElement {
  return (
    <div
      role="status"
      className={cn("flex min-h-40 items-center justify-center text-center", className)}
    >
      <div className="flex flex-col items-center gap-3">
        <LoaderCircle className="size-6 animate-spin text-status-running" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{COPY.title}</p>
          <p className="text-sm text-muted-foreground">{COPY.description}</p>
        </div>
      </div>
    </div>
  );
}
