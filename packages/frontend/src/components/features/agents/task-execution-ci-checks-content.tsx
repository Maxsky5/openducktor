import type {
  PullRequestReviewAggregateStatus,
  PullRequestReviewCheck,
  PullRequestReviewComment,
  PullRequestReviewContext,
} from "@openducktor/contracts";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { humanDate } from "@/lib/task-display";

type LoadedPullRequestReviewContext = Extract<PullRequestReviewContext, { status: "loaded" }>;

const aggregateBadgeVariant = (
  status: PullRequestReviewAggregateStatus,
): "success" | "danger" | "warning" | "secondary" => {
  if (status === "success") {
    return "success";
  }
  if (status === "failure") {
    return "danger";
  }
  if (status === "pending") {
    return "warning";
  }
  return "secondary";
};

const aggregateLabel = (status: PullRequestReviewAggregateStatus): string => {
  if (status === "success") {
    return "Passing";
  }
  if (status === "failure") {
    return "Failing";
  }
  if (status === "pending") {
    return "Pending";
  }
  if (status === "neutral") {
    return "Neutral";
  }
  return "Unknown";
};

const checkBadgeVariant = (
  check: PullRequestReviewCheck,
): "success" | "danger" | "warning" | "secondary" => {
  if (check.status !== "completed") {
    return "warning";
  }
  if (check.conclusion === "success" || check.conclusion === "skipped") {
    return "success";
  }
  if (
    check.conclusion === "failure" ||
    check.conclusion === "cancelled" ||
    check.conclusion === "timed_out" ||
    check.conclusion === "action_required"
  ) {
    return "danger";
  }
  return "secondary";
};

const checkLabel = (check: PullRequestReviewCheck): string => {
  if (check.status !== "completed") {
    return check.status.replaceAll("_", " ");
  }
  return check.conclusion?.replaceAll("_", " ") ?? "completed";
};

const providerLabel = (providerId: PullRequestReviewContext["providerId"]): string => {
  if (providerId === "github") {
    return "GitHub";
  }
  return providerId;
};

const stateLabel = (state: LoadedPullRequestReviewContext["pullRequest"]["state"]): string =>
  state.replaceAll("_", " ");

const sourceLabel = (source: PullRequestReviewComment["source"]): string => {
  if (source === "review_thread") {
    return "Review thread";
  }
  if (source === "review") {
    return "Review";
  }
  return "Comment";
};

function TimestampLine({ label, timestamp }: { label: string; timestamp: string }): ReactElement {
  return (
    <span>
      {label}{" "}
      <time dateTime={timestamp} title={timestamp}>
        {humanDate(timestamp)}
      </time>
    </span>
  );
}

export function TaskExecutionCiPanelState({ message }: { message: string }): ReactElement {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function TaskExecutionCiUnavailable({
  context,
}: {
  context: Exclude<PullRequestReviewContext, { status: "loaded" }>;
}): ReactElement {
  return <TaskExecutionCiPanelState message={context.reason} />;
}

function ChecksList({ checks }: { checks: PullRequestReviewCheck[] }): ReactElement {
  if (checks.length === 0) {
    return <p className="text-sm text-muted-foreground">No checks reported.</p>;
  }

  return (
    <div className="space-y-2">
      {checks.map((check) => {
        const content = (
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
                    <TimestampLine label="Started" timestamp={check.startedAt} />
                  ) : null}
                  {check.completedAt ? (
                    <TimestampLine label="Completed" timestamp={check.completedAt} />
                  ) : null}
                </div>
              ) : null}
            </div>
            <Badge variant={checkBadgeVariant(check)} className="shrink-0 capitalize">
              {checkLabel(check)}
            </Badge>
          </div>
        );

        if (!check.url) {
          return <div key={check.name}>{content}</div>;
        }

        return (
          <a
            key={check.name}
            href={check.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content}
          </a>
        );
      })}
    </div>
  );
}

function CommentCard({ comment }: { comment: PullRequestReviewComment }): ReactElement {
  const showThreadBadge = comment.isResolved !== null;

  return (
    <article className="space-y-2 rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{comment.author ?? "Unknown author"}</div>
          {comment.path ? (
            <div className="truncate text-xs text-muted-foreground">
              {comment.path}
              {comment.line ? `:${comment.line}` : ""}
            </div>
          ) : null}
        </div>
        {showThreadBadge ? (
          <Badge variant={comment.isResolved === true ? "success" : "warning"} className="shrink-0">
            {comment.isResolved === true ? "Resolved" : "Unresolved"}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{sourceLabel(comment.source)}</span>
        {comment.threadId ? <span title={`Thread ${comment.threadId}`}>Thread</span> : null}
        {comment.createdAt ? <TimestampLine label="Created" timestamp={comment.createdAt} /> : null}
        {comment.updatedAt ? <TimestampLine label="Updated" timestamp={comment.updatedAt} /> : null}
      </div>
      {comment.body.trim().length > 0 ? (
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{comment.body}</p>
      ) : (
        <p className="text-sm text-muted-foreground">No comment body.</p>
      )}
      {comment.url ? (
        <a
          href={comment.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Open comment
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </article>
  );
}

function CommentsList({ comments }: { comments: PullRequestReviewComment[] }): ReactElement {
  if (comments.length === 0) {
    return <p className="text-sm text-muted-foreground">No comments reported.</p>;
  }

  return (
    <div className="space-y-2">
      {comments.map((comment) => (
        <CommentCard key={comment.id} comment={comment} />
      ))}
    </div>
  );
}

export function TaskExecutionCiLoaded({
  context,
  onRefresh,
  isRefreshing,
}: {
  context: LoadedPullRequestReviewContext;
  onRefresh: () => void;
  isRefreshing: boolean;
}): ReactElement {
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
          <ChecksList checks={context.checks} />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Comments</h3>
          <CommentsList comments={context.comments} />
        </section>
      </div>
    </div>
  );
}
