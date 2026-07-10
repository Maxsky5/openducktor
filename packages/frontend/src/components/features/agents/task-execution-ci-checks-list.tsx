import type {
  PullRequestReviewAggregateStatus,
  PullRequestReviewCheck,
} from "@openducktor/contracts";
import { CheckCircle2, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TaskExecutionCiCheckCard } from "./task-execution-ci-check-card";
import { aggregateLabel } from "./task-execution-ci-presentation";

const AGGREGATE_STATUS_PRESENTATION = {
  failure: {
    badgeVariant: "danger",
    textClassName: "text-destructive-muted",
  },
  neutral: {
    badgeVariant: "secondary",
    textClassName: "text-muted-foreground",
  },
  pending: {
    badgeVariant: "warning",
    textClassName: "text-warning-muted",
  },
  success: {
    badgeVariant: "success",
    textClassName: "text-success-muted",
  },
  unknown: {
    badgeVariant: "secondary",
    textClassName: "text-muted-foreground",
  },
} as const satisfies Record<
  PullRequestReviewAggregateStatus,
  {
    badgeVariant: "danger" | "secondary" | "success" | "warning";
    textClassName: string;
  }
>;

export function TaskExecutionCiChecksList({
  aggregateStatus,
  checks,
  summaryLabel,
}: {
  aggregateStatus: PullRequestReviewAggregateStatus;
  checks: PullRequestReviewCheck[];
  summaryLabel: string;
}): ReactElement {
  const statusPresentation = AGGREGATE_STATUS_PRESENTATION[aggregateStatus];

  return (
    <details className="group/checks" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 outline-none transition hover:bg-accent/40 focus-visible:bg-accent/50 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/checks:rotate-90" />
          <CheckCircle2 className={cn("size-4 shrink-0", statusPresentation.textClassName)} />
          <h3 className="text-sm font-semibold text-foreground">Checks</h3>
          <span className={cn("text-xs font-medium", statusPresentation.textClassName)}>
            {summaryLabel}
          </span>
        </div>
        <Badge variant={statusPresentation.badgeVariant} className="shrink-0">
          {aggregateLabel(aggregateStatus)}
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
