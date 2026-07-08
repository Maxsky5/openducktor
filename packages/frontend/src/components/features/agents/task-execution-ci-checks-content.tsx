import type { PullRequest, PullRequestReviewContext } from "@openducktor/contracts";
import { RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { Button } from "@/components/ui/button";
import { TaskExecutionCiChecksList } from "./task-execution-ci-checks-list";
import { TaskExecutionCiCommentsList } from "./task-execution-ci-comments-list";
import {
  aggregateLabel,
  checksSummaryLabel,
  providerLabel,
} from "./task-execution-ci-presentation";

type LoadedPullRequestReviewContext = Extract<PullRequestReviewContext, { status: "loaded" }>;
type RefreshState = "idle" | "refreshing";

const toPullRequestLinkModel = (context: LoadedPullRequestReviewContext): PullRequest => ({
  providerId: context.pullRequest.providerId,
  number: context.pullRequest.number,
  url: context.pullRequest.url,
  state: context.pullRequest.state === "closed" ? "closed_unmerged" : context.pullRequest.state,
  createdAt: context.refreshedAt,
  updatedAt: context.refreshedAt,
});

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
  const pullRequestLink = toPullRequestLinkModel(context);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <TaskPullRequestLink pullRequest={pullRequestLink} className="shrink-0" />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Refresh CI checks"
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={isRefreshing ? "size-3.5 animate-spin" : "size-3.5"} />
          </Button>
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
