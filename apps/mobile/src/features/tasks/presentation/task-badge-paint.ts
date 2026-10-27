import { type BuiltinIssueTypeId as IssueType } from "@openducktor/workflows";
import type { PullRequest, SourceIssueReference } from "@openducktor/contracts";
import {
  ISSUE_TYPE_LABELS,
  PRIORITY_LABELS,
  type PriorityLevel,
  toPriorityLevel,
} from "@openducktor/frontend-core/tasks/board/kanban-task-badge-model";
import {
  PULL_REQUEST_STATE_LABELS,
  pullRequestLabel,
} from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";
import type { IconName } from "@/ui/icon-names";
import type { Tone } from "@/ui/tones";

/** The label, color tone, and icon of a badge. The label always shows with the color. */
export type BadgePaint = { label: string; tone: Tone; icon: IconName };

/** The desktop issue type badges: Feature sky, Bug rose, and Task neutral. */
const ISSUE_TYPE_PAINT = {
  feature: { label: ISSUE_TYPE_LABELS.feature, tone: "info", icon: "sparkles" },
  bug: { label: ISSUE_TYPE_LABELS.bug, tone: "destructive", icon: "bug" },
  task: { label: ISSUE_TYPE_LABELS.task, tone: "neutral", icon: "square-check" },
} as const satisfies Record<IssueType, BadgePaint>;

export const issueTypePaint = (issueType: IssueType): BadgePaint => ISSUE_TYPE_PAINT[issueType];

/** The desktop priority colors: P0 rose, P1 orange, P2 amber, P3 sky, and P4 neutral. */
const PRIORITY_TONES = {
  0: "destructive",
  1: "cancelled",
  2: "warning",
  3: "info",
  4: "neutral",
} as const satisfies Record<PriorityLevel, Tone>;

export type PriorityPaint = { label: string; hint: string; tone: Tone };

export const priorityPaint = (priority: number): PriorityPaint => {
  const level = toPriorityLevel(priority);
  return { ...PRIORITY_LABELS[level], tone: PRIORITY_TONES[level] };
};

/** The desktop pull request states: open emerald, draft neutral, merged violet, closed rose. */
const PULL_REQUEST_STATE_PAINT = {
  open: { tone: "success", icon: "git-pull-request" },
  draft: { tone: "neutral", icon: "git-pull-request-draft" },
  merged: { tone: "pending", icon: "git-merge" },
  closed_unmerged: { tone: "destructive", icon: "git-pull-request-closed" },
} as const satisfies Record<PullRequest["state"], Omit<BadgePaint, "label">>;

export type PullRequestPaint = BadgePaint & { stateLabel: string };

export const pullRequestPaint = (
  pullRequest: Pick<PullRequest, "number" | "state">,
): PullRequestPaint => ({
  label: pullRequestLabel(pullRequest),
  stateLabel: PULL_REQUEST_STATE_LABELS[pullRequest.state],
  ...PULL_REQUEST_STATE_PAINT[pullRequest.state],
});

/** The short name of the provider item that a task came from, such as "GitHub #12". */
export const sourceIssueLabel = (
  sourceIssue: Pick<SourceIssueReference, "providerId" | "number">,
): string =>
  `${sourceIssue.providerId === "github" ? "GitHub" : "Azure DevOps"} #${sourceIssue.number}`;
