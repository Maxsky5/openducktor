import type { IssueType, RunSummary } from "@openducktor/contracts";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bug,
  CheckSquare,
  Layers3,
  Loader2,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";

const ISSUE_TYPE_STYLES: Record<
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
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  feature: {
    label: "Feature",
    icon: Sparkles,
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  epic: {
    label: "Epic",
    icon: Layers3,
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  task: {
    label: "Task",
    icon: CheckSquare,
    className: "border-slate-200 bg-slate-100 text-slate-700",
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
    badgeClassName: "border-rose-200 bg-rose-50 text-rose-700",
  },
  1: {
    label: "P1",
    hint: "High",
    dotClassName: "bg-orange-500",
    badgeClassName: "border-orange-200 bg-orange-50 text-orange-700",
  },
  2: {
    label: "P2",
    hint: "Normal",
    dotClassName: "bg-amber-500",
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
  },
  3: {
    label: "P3",
    hint: "Low",
    dotClassName: "bg-sky-500",
    badgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
  },
  4: {
    label: "P4",
    hint: "Lowest",
    dotClassName: "bg-slate-400",
    badgeClassName: "border-slate-200 bg-slate-100 text-slate-700",
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

const getPriorityStyle = (priority: number): (typeof PRIORITY_STYLES)[PriorityLevel] =>
  PRIORITY_STYLES[toPriorityLevel(priority)];

const runStateLabel = (value: RunSummary["state"]): string => {
  switch (value) {
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "blocked":
      return "Blocked";
    case "awaiting_done_confirmation":
      return "Awaiting confirm";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
};

const runStateIcon = (value: RunSummary["state"]): LucideIcon => {
  if (value === "running" || value === "starting") {
    return Loader2;
  }
  if (value === "blocked" || value === "failed") {
    return AlertTriangle;
  }
  return PlayCircle;
};

const runStateClassName = (value: RunSummary["state"]): string => {
  if (value === "blocked" || value === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (value === "running" || value === "starting") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
};

export function IssueTypeBadge({ issueType }: { issueType: IssueType }): ReactElement {
  const style = ISSUE_TYPE_STYLES[issueType] ?? ISSUE_TYPE_STYLES.task;
  const Icon = style.icon;
  return (
    <Badge
      variant="outline"
      className={`h-6 rounded-full gap-1.5 px-2.5 text-[11px] font-semibold ${style.className}`}
    >
      <Icon className="size-3" />
      {style.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: number }): ReactElement {
  const style = getPriorityStyle(priority);
  return (
    <Badge
      variant="outline"
      className={`h-6 rounded-full gap-1.5 px-2.5 text-[11px] font-semibold ${style.badgeClassName}`}
      title={style.hint}
    >
      <span className={`size-1.5 rounded-full ${style.dotClassName}`} />
      {style.label}
    </Badge>
  );
}

export function RunStateBadge({ runState }: { runState: RunSummary["state"] }): ReactElement {
  const Icon = runStateIcon(runState);
  return (
    <Badge
      variant="outline"
      className={`h-6 rounded-full px-2.5 text-[11px] font-medium gap-1 ${runStateClassName(runState)}`}
    >
      <Icon className={runState === "starting" ? "size-3 animate-spin" : "size-3"} />
      {runStateLabel(runState)}
    </Badge>
  );
}
