import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type HeaderNoticeItem = {
  key: string;
  tone: "warning" | "error" | "muted";
  id?: string;
  testId?: string;
  children: ReactNode;
};

/** The notices under the branch row, in display order. */
export function headerNotices(input: {
  detectPullRequestError: string | null;
  lockReason: string | null;
  refreshError: string | null;
  upstreamError: string | null;
  comparisonUnavailableReason: string | null;
  rebaseError: string | null;
  pushError: string | null;
}): HeaderNoticeItem[] {
  const notices: HeaderNoticeItem[] = [];
  if (input.detectPullRequestError) {
    notices.push({
      key: "detect-pr",
      tone: "error",
      id: DETECT_PR_ERROR_ID,
      testId: DETECT_PR_ERROR_ID,
      children: input.detectPullRequestError,
    });
  }
  if (input.lockReason) {
    notices.push({
      key: "lock",
      tone: "warning",
      testId: "agent-studio-git-lock-reason",
      children: input.lockReason,
    });
  }
  if (input.refreshError) {
    notices.push({
      key: "refresh",
      tone: "error",
      testId: "agent-studio-git-refresh-error",
      children: `Refresh failed: ${input.refreshError}`,
    });
  }
  if (input.upstreamError !== null) {
    notices.push({
      key: "upstream",
      tone: "error",
      children: `Upstream status is unavailable. ${input.upstreamError}`,
    });
  }
  if (input.comparisonUnavailableReason) {
    notices.push({
      key: "comparison",
      tone: "muted",
      testId: "agent-studio-git-comparison-unavailable",
      children: input.comparisonUnavailableReason,
    });
  }
  if (input.rebaseError) {
    notices.push({
      key: "rebase",
      tone: "error",
      testId: "agent-studio-git-rebase-error",
      children: input.rebaseError,
    });
  }
  if (input.pushError) {
    notices.push({
      key: "push",
      tone: "error",
      testId: "agent-studio-git-push-error",
      children: input.pushError,
    });
  }
  return notices;
}

export const DETECT_PR_ERROR_ID = "agent-studio-git-detect-pr-error";

export function HeaderNotice({
  tone,
  id,
  testId,
  children,
}: {
  tone: "warning" | "error" | "muted";
  id?: string;
  testId?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <p
      id={id}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "border-b border-border px-3 py-1.5 text-xs",
        tone === "warning" && "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
        tone === "error" && "bg-destructive/10 text-destructive",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
      data-testid={testId}
    >
      {children}
    </p>
  );
}
