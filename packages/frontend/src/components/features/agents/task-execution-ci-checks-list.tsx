import type { PullRequestReviewCheck } from "@openducktor/contracts";
import { CheckCircle2 } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { TaskExecutionCiCheckCard } from "./task-execution-ci-check-card";

export function TaskExecutionCiChecksList({
  aggregateLabel,
  checks,
  summaryLabel,
}: {
  aggregateLabel: string;
  checks: PullRequestReviewCheck[];
  summaryLabel: string;
}): ReactElement {
  if (checks.length === 0) {
    return <div className="px-4 py-4 text-sm text-muted-foreground">No checks reported.</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Checks</h3>
          <span className="text-xs text-muted-foreground">{summaryLabel}</span>
        </div>
        <Badge variant="outline" className="shrink-0">
          {aggregateLabel}
        </Badge>
      </div>
      <div className="divide-y divide-border border-t border-border bg-card/40">
        {checks.map((check) => (
          <TaskExecutionCiCheckCard key={check.name} check={check} />
        ))}
      </div>
    </div>
  );
}
