import type { PullRequestReviewCheck } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { checkBadgeVariant, checkLabel } from "./task-execution-ci-presentation";
import { TaskExecutionCiTimestampLine } from "./task-execution-ci-timestamp-line";

export function TaskExecutionCiCheckCard({
  check,
}: {
  check: PullRequestReviewCheck;
}): ReactElement {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{check.name}</div>
        {check.workflow ? (
          <div className="truncate text-xs text-muted-foreground">{check.workflow}</div>
        ) : null}
        {check.details ? (
          <div className="mt-1 text-xs text-muted-foreground">{check.details}</div>
        ) : null}
        {check.startedAt || check.completedAt ? (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {check.startedAt ? (
              <TaskExecutionCiTimestampLine label="Started" timestamp={check.startedAt} />
            ) : null}
            {check.completedAt ? (
              <TaskExecutionCiTimestampLine label="Completed" timestamp={check.completedAt} />
            ) : null}
          </div>
        ) : null}
      </div>
      <Badge variant={checkBadgeVariant(check)} className="shrink-0 capitalize">
        {checkLabel(check)}
      </Badge>
    </div>
  );
}
