import type { PullRequestReviewContext } from "@openducktor/contracts";
import { ExternalLink, GitPullRequest, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskExecutionCiChecksList } from "./task-execution-ci-checks-list";
import { TaskExecutionCiCommentsList } from "./task-execution-ci-comments-list";
import {
  aggregateBadgeVariant,
  aggregateLabel,
  checksSummaryLabel,
  providerLabel,
  stateLabel,
} from "./task-execution-ci-presentation";

type LoadedPullRequestReviewContext = Extract<PullRequestReviewContext, { status: "loaded" }>;
type RefreshState = "idle" | "refreshing";

export function TaskExecutionCiLoaded({
  context,
  onRefresh,
  refreshState,
}: {
  context: LoadedPullRequestReviewContext;
  onRefresh: () => void;
  refreshState: RefreshState;
}): ReactElement {
  const isRefreshing = refreshState === "refreshing";
  const checkSummary = checksSummaryLabel(context.checks);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
            <a
              href={context.pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate text-sm font-semibold text-foreground underline-offset-2 hover:underline"
            >
              #{context.pullRequest.number}
            </a>
            <Badge variant="outline" className="shrink-0 uppercase">
              {stateLabel(context.pullRequest.state)}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label="Refresh CI checks"
              disabled={isRefreshing}
              onClick={onRefresh}
            >
              <RefreshCw className={isRefreshing ? "size-3.5 animate-spin" : "size-3.5"} />
            </Button>
            <a
              href={context.pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label={`Open pull request #${context.pullRequest.number}`}
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>
        <a
          href={context.pullRequest.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-sm font-medium leading-6 text-foreground underline-offset-2 hover:underline"
        >
          {context.pullRequest.title}
        </a>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Updated {new Date(context.refreshedAt).toLocaleTimeString()}</span>
          <span aria-hidden="true">•</span>
          <span>{providerLabel(context.pullRequest.providerId)}</span>
          <span aria-hidden="true">•</span>
          <span>{checkSummary}</span>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
          <Badge variant={aggregateBadgeVariant(context.aggregateStatus)}>
            {aggregateLabel(context.aggregateStatus)}
          </Badge>
          <span className="text-xs text-muted-foreground">{checkSummary}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border">
          <TaskExecutionCiChecksList
            checks={context.checks}
            summaryLabel={checkSummary}
            aggregateLabel={aggregateLabel(context.aggregateStatus)}
          />
        </section>
        <section>
          <TaskExecutionCiCommentsList comments={context.comments} />
        </section>
      </div>
    </div>
  );
}
