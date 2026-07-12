import type { PullRequestReviewContext } from "@openducktor/contracts";
import { RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { TaskExecutionCiChecksList } from "./task-execution-ci-checks-list";
import { TaskExecutionCiCommentsList } from "./task-execution-ci-comments-list";
import { checksSummaryLabel } from "./task-execution-ci-presentation";

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
      <div className="border-b border-border px-4 py-2.5">
        <a
          href={context.pullRequest.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-medium leading-5 text-foreground underline-offset-2 hover:underline"
        >
          {context.pullRequest.title}
        </a>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Updated {new Date(context.refreshedAt).toLocaleTimeString()}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Refresh CI checks"
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={isRefreshing ? "size-3.5 animate-spin" : "size-3.5"} />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border">
          <TaskExecutionCiChecksList
            aggregateStatus={context.aggregateStatus}
            checks={context.checks}
            summaryLabel={checkSummary}
          />
        </section>
        <section>
          <TaskExecutionCiCommentsList comments={context.comments} />
        </section>
      </div>
    </div>
  );
}
