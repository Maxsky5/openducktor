import type { LucideIcon } from "lucide-react";
import { Bug, CheckSquare, Sparkles, FileText } from "lucide-react";
import { taskIssueType, type ResolvedTaskCard } from "@openducktor/workflows";
import type { WorkflowIcon } from "@openducktor/contracts";
import {
  PRIORITY_LABELS,
  type PriorityLevel,
  toPriorityLevel,
} from "@openducktor/frontend-core/tasks/board/kanban-task-badge-model";

type IssueTypeStyle = { icon: LucideIcon; iconClassName: string; className: string };

/** The badge paint of the issue type icons. Other icons use the neutral paint. */
const ISSUE_TYPE_STYLES = new Map<WorkflowIcon, IssueTypeStyle>([
  [
    "bug",
    {
      icon: Bug,
      iconClassName: "text-rose-600 dark:text-rose-400",
      className:
        "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300",
    },
  ],
  [
    "feature",
    {
      icon: Sparkles,
      iconClassName: "text-sky-600 dark:text-sky-400",
      className:
        "border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300",
    },
  ],
  [
    "task",
    {
      icon: CheckSquare,
      iconClassName: "text-foreground",
      className: "border-border bg-muted text-foreground",
    },
  ],
]);
const NEUTRAL_ISSUE_TYPE_STYLE: IssueTypeStyle = {
  icon: FileText,
  iconClassName: "text-foreground",
  className: "border-border bg-muted text-foreground",
};

export const PRIORITY_STYLES = {
  0: {
    ...PRIORITY_LABELS[0],
    dotClassName: "bg-rose-500",
    badgeClassName:
      "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300",
  },
  1: {
    ...PRIORITY_LABELS[1],
    dotClassName: "bg-orange-500",
    badgeClassName:
      "border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300",
  },
  2: {
    ...PRIORITY_LABELS[2],
    dotClassName: "bg-amber-500",
    badgeClassName:
      "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300",
  },
  3: {
    ...PRIORITY_LABELS[3],
    dotClassName: "bg-sky-500",
    badgeClassName:
      "border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300",
  },
  4: {
    ...PRIORITY_LABELS[4],
    dotClassName: "bg-muted-foreground",
    badgeClassName: "border-border bg-muted text-foreground",
  },
} satisfies Record<
  PriorityLevel,
  {
    label: string;
    hint: string;
    dotClassName: string;
    badgeClassName: string;
  }
>;

export const issueTypeStyle = (choice: {
  id: string;
  label: string;
  icon?: WorkflowIcon | undefined;
}) => ({
  ...((choice.icon && ISSUE_TYPE_STYLES.get(choice.icon)) || NEUTRAL_ISSUE_TYPE_STYLE),
  label: choice.label,
});
export const taskIssueTypeStyle = (task: ResolvedTaskCard) => issueTypeStyle(taskIssueType(task));

export const getPriorityStyle = (priority: number): (typeof PRIORITY_STYLES)[PriorityLevel] =>
  PRIORITY_STYLES[toPriorityLevel(priority)];
