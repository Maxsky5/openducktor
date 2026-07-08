import type { PullRequestReviewContext } from "@openducktor/contracts";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskExecutionCiChecksList } from "./task-execution-ci-checks-list";
import { TaskExecutionCiCommentsList } from "./task-execution-ci-comments-list";
import {
  aggregateBadgeVariant,
  aggregateLabel,
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <a
              href={context.pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 truncate text-sm font-semibold text-foreground underline-offset-2 hover:underline"
            >
              <span className="truncate">
                #{context.pullRequest.number} {context.pullRequest.title}
              </span>
              <ExternalLink className="size-3.5 shrink-0" />
            </a>
            <div className="text-xs text-muted-foreground">
              Updated {new Date(context.refreshedAt).toLocaleTimeString()}
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              <Badge variant="outline">{providerLabel(context.pullRequest.providerId)}</Badge>
              <Badge variant="secondary" className="capitalize">
                {stateLabel(context.pullRequest.state)}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={aggregateBadgeVariant(context.aggregateStatus)}>
              {aggregateLabel(context.aggregateStatus)}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Refresh CI checks"
              disabled={isRefreshing}
              onClick={onRefresh}
            >
              <RefreshCw className={isRefreshing ? "size-3.5 animate-spin" : "size-3.5"} />
            </Button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Checks</h3>
          <TaskExecutionCiChecksList checks={context.checks} />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Comments</h3>
          <TaskExecutionCiCommentsList comments={context.comments} />
        </section>
      </div>
    </div>
  );
}
