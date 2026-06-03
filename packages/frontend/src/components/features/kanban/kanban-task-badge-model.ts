import type { IssueType } from "@openducktor/contracts";
import type { LucideIcon } from "lucide-react";
import { Bug, CheckSquare, Layers3, Sparkles } from "lucide-react";

export const ISSUE_TYPE_STYLES: Record<
  IssueType,
  {
    label: string;
    icon: LucideIcon;
    className: string;
  }
> = {
  bug: {
    label: "Bug",
    icon: Bug,
    className:
      "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300",
  },
  feature: {
    label: "Feature",
    icon: Sparkles,
    className:
      "border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300",
  },
  epic: {
    label: "Epic",
    icon: Layers3,
    className:
      "border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300",
  },
  task: {
    label: "Task",
    icon: CheckSquare,
    className: "border-border bg-muted text-foreground",
  },
};

type PriorityLevel = 0 | 1 | 2 | 3 | 4;

const PRIORITY_STYLES: Record<
  PriorityLevel,
  {
    label: string;
    hint: string;
    dotClassName: string;
    badgeClassName: string;
  }
> = {
  0: {
    label: "P0",
    hint: "Critical",
    dotClassName: "bg-rose-500",
    badgeClassName:
      "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300",
  },
  1: {
    label: "P1",
    hint: "High",
    dotClassName: "bg-orange-500",
    badgeClassName:
      "border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300",
  },
  2: {
    label: "P2",
    hint: "Normal",
    dotClassName: "bg-amber-500",
    badgeClassName:
      "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300",
  },
  3: {
    label: "P3",
    hint: "Low",
    dotClassName: "bg-sky-500",
    badgeClassName:
      "border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300",
  },
  4: {
    label: "P4",
    hint: "Lowest",
    dotClassName: "bg-muted-foreground",
    badgeClassName: "border-border bg-muted text-foreground",
  },
};

const toPriorityLevel = (priority: number): PriorityLevel => {
  if (!Number.isFinite(priority)) {
    return 4;
  }
  if (priority <= 0) {
    return 0;
  }
  if (priority >= 4) {
    return 4;
  }
  return priority as PriorityLevel;
};

export const getPriorityStyle = (priority: number): (typeof PRIORITY_STYLES)[PriorityLevel] =>
  PRIORITY_STYLES[toPriorityLevel(priority)];
