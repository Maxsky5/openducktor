import type { PullRequestReviewCheck } from "@openducktor/contracts";
import { CheckCircle2, ChevronRight } from "lucide-react";
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
  return (
    <details className="group/checks" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 outline-none transition hover:bg-accent/40 focus-visible:bg-accent/50 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/checks:rotate-90" />
          <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Checks</h3>
          <span className="text-xs text-muted-foreground">{summaryLabel}</span>
        </div>
        <Badge variant="outline" className="shrink-0">
          {aggregateLabel}
        </Badge>
      </summary>
      <div className="divide-y divide-border border-t border-border bg-card/40">
        {checks.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">No checks reported.</div>
        ) : (
          checks.map((check) => <TaskExecutionCiCheckCard key={check.name} check={check} />)
        )}
      </div>
    </details>
  );
}
