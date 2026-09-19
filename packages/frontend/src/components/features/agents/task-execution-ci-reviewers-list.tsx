import type { PullRequestReviewer } from "@openducktor/contracts";
import { ChevronRight, Users } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";

const REVIEWER_DECISION_PRESENTATION = {
  approved: { label: "Approved", variant: "success" },
  approved_with_suggestions: { label: "Approved with suggestions", variant: "warning" },
  no_vote: { label: "No vote", variant: "secondary" },
  waiting_for_author: { label: "Waiting for author", variant: "warning" },
  rejected: { label: "Rejected", variant: "danger" },
  unknown: { label: "Unknown", variant: "secondary" },
} as const satisfies Record<
  PullRequestReviewer["decision"],
  { label: string; variant: "success" | "warning" | "secondary" | "danger" }
>;

export function TaskExecutionCiReviewersList({
  reviewers,
}: {
  reviewers: PullRequestReviewer[];
}): ReactElement {
  return (
    <details className="group/reviewers" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 outline-none transition hover:bg-accent/40 focus-visible:bg-accent/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/reviewers:rotate-90" />
        <Users className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Reviewers</h3>
        <Badge variant="secondary" className="shrink-0">
          {reviewers.length}
        </Badge>
      </summary>
      <div className="divide-y divide-border border-t border-border bg-card/40">
        {reviewers.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">No reviewers reported.</div>
        ) : (
          reviewers.map((reviewer) => {
            const decision = REVIEWER_DECISION_PRESENTATION[reviewer.decision];
            return (
              <div
                key={reviewer.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {reviewer.displayName}
                </span>
                <div className="flex items-center gap-2">
                  {reviewer.isRequired ? <Badge variant="outline">Required</Badge> : null}
                  <Badge variant={decision.variant}>{decision.label}</Badge>
                </div>
              </div>
            );
          })
        )}
      </div>
    </details>
  );
}
