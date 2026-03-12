import type { PullRequest } from "@openducktor/contracts";
import {
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import type { ReactElement } from "react";
import { toast } from "sonner";
import { badgeVariants } from "@/components/ui/badge";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { cn } from "@/lib/utils";

const PULL_REQUEST_STATUS_STYLES: Record<PullRequest["state"], string> = {
  open: "text-emerald-600 dark:text-emerald-400",
  draft: "text-zinc-600 dark:text-zinc-400",
  merged: "text-violet-600 dark:text-violet-400",
  closed_unmerged: "text-rose-600 dark:text-rose-400",
};

const PULL_REQUEST_STATUS_ICONS: Record<PullRequest["state"], typeof GitPullRequest> = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed_unmerged: GitPullRequestClosed,
};

export function TaskPullRequestLink({
  pullRequest,
  className,
}: {
  pullRequest: PullRequest;
  className?: string;
}): ReactElement {
  const StatusIcon = PULL_REQUEST_STATUS_ICONS[pullRequest.state];

  const handleClick = (): void => {
    void openExternalUrl(pullRequest.url).catch((error) => {
      toast.error("Failed to open pull request", {
        description: errorMessage(error),
      });
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        badgeVariants({ variant: "outline" }),
        "inline-flex text-muted-foreground cursor-pointer items-center gap-1.5 rounded-full border-border bg-card px-2.5 py-1 text-[11px] font-semibold hover:bg-muted",
        className,
      )}
    >
      <StatusIcon className={cn("size-3.5", PULL_REQUEST_STATUS_STYLES[pullRequest.state])} />
      <span>PR #{pullRequest.number}</span>
      <ExternalLink className="size-3" />
    </button>
  );
}
