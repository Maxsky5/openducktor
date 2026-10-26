import type { IssueType } from "@openducktor/contracts";
import type { LucideIcon } from "lucide-react";
import { Bug, CheckSquare, Layers3, Sparkles } from "lucide-react";
import {
  ISSUE_TYPE_LABELS,
  PRIORITY_LABELS,
  type PriorityLevel,
  toPriorityLevel,
} from "@openducktor/frontend-core/tasks/board/kanban-task-badge-model";

export const ISSUE_TYPE_STYLES = {
  bug: {
    label: ISSUE_TYPE_LABELS.bug,
    icon: Bug,
    iconClassName: "text-rose-600 dark:text-rose-400",
    className:
      "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300",
  },
  feature: {
    label: ISSUE_TYPE_LABELS.feature,
    icon: Sparkles,
    iconClassName: "text-sky-600 dark:text-sky-400",
    className:
      "border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300",
  },
  epic: {
    label: ISSUE_TYPE_LABELS.epic,
    icon: Layers3,
    iconClassName: "text-violet-600 dark:text-violet-400",
    className:
      "border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300",
  },
  task: {
    label: ISSUE_TYPE_LABELS.task,
    icon: CheckSquare,
    iconClassName: "text-foreground",
    className: "border-border bg-muted text-foreground",
  },
} satisfies Record<
  IssueType,
  {
    label: string;
    icon: LucideIcon;
    iconClassName: string;
    className: string;
  }
>;

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

export const getPriorityStyle = (priority: number): (typeof PRIORITY_STYLES)[PriorityLevel] =>
  PRIORITY_STYLES[toPriorityLevel(priority)];
