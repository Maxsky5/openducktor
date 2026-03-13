import type { TaskCard } from "@openducktor/contracts";
import type { KanbanColumnId } from "@openducktor/core";

export type KanbanLaneTheme = {
  boardSurfaceClass: string;
  headerSurfaceClass: string;
  headerAccentClass: string;
  countBadgeClass: string;
  emptyStateClass: string;
};

type TaskStatusPresentation = {
  label: string;
  badgeClassName: string;
  laneTheme?: KanbanLaneTheme;
};

const DEFAULT_LANE_THEME: KanbanLaneTheme = {
  boardSurfaceClass: "border-border/90 bg-muted/55",
  headerSurfaceClass: "bg-muted/70",
  headerAccentClass: "bg-muted/0",
  countBadgeClass: "border-input bg-card text-foreground",
  emptyStateClass: "border-input/80 bg-card/70 text-muted-foreground",
};

const TASK_STATUS_PRESENTATION: Record<TaskCard["status"], TaskStatusPresentation> = {
  open: {
    label: "Backlog",
    badgeClassName: "border-input bg-muted text-foreground",
    laneTheme: {
      boardSurfaceClass: "border-border/90 bg-muted/60",
      headerSurfaceClass: "bg-muted/80",
      headerAccentClass: "bg-muted/0",
      countBadgeClass: "border-input bg-card text-foreground",
      emptyStateClass: "border-input/80 bg-card/80 text-muted-foreground",
    },
  },
  spec_ready: {
    label: "Spec ready",
    badgeClassName: "border-pending-border bg-pending-surface text-pending-muted",
    laneTheme: {
      boardSurfaceClass:
        "border-violet-200/90 dark:border-violet-800/60 bg-violet-50/55 dark:bg-violet-950/30",
      headerSurfaceClass: "bg-violet-50/75 dark:bg-violet-950/40",
      headerAccentClass: "bg-violet-500",
      countBadgeClass:
        "border-violet-300 dark:border-violet-700 bg-card text-violet-700 dark:text-violet-300",
      emptyStateClass:
        "border-violet-200/80 dark:border-violet-800/50 bg-card/80 text-violet-600 dark:text-violet-400",
    },
  },
  ready_for_dev: {
    label: "Ready for dev",
    badgeClassName: "border-info-border bg-info-surface text-info-muted",
    laneTheme: {
      boardSurfaceClass: "border-sky-200/90 dark:border-sky-800/60 bg-sky-50/55 dark:bg-sky-950/30",
      headerSurfaceClass: "bg-sky-50/75 dark:bg-sky-950/40",
      headerAccentClass: "bg-sky-500",
      countBadgeClass: "border-sky-300 dark:border-sky-700 bg-card text-sky-700 dark:text-sky-300",
      emptyStateClass:
        "border-sky-200/80 dark:border-sky-800/50 bg-card/80 text-sky-700 dark:text-sky-300",
    },
  },
  in_progress: {
    label: "In progress",
    badgeClassName: "border-warning-border bg-warning-surface text-warning-muted",
    laneTheme: {
      boardSurfaceClass:
        "border-amber-200/90 dark:border-amber-800/60 bg-amber-50/55 dark:bg-amber-950/30",
      headerSurfaceClass: "bg-amber-50/75 dark:bg-amber-950/40",
      headerAccentClass: "bg-amber-500",
      countBadgeClass:
        "border-amber-300 dark:border-amber-700 bg-card text-amber-700 dark:text-amber-300",
      emptyStateClass:
        "border-amber-200/80 dark:border-amber-800/50 bg-card/80 text-amber-700 dark:text-amber-300",
    },
  },
  blocked: {
    label: "Blocked needs input",
    badgeClassName: "border-destructive-border bg-destructive-surface text-destructive-muted",
    laneTheme: {
      boardSurfaceClass:
        "border-rose-200/90 dark:border-rose-800/60 bg-rose-50/55 dark:bg-rose-950/30",
      headerSurfaceClass: "bg-rose-50/75 dark:bg-rose-950/40",
      headerAccentClass: "bg-rose-500",
      countBadgeClass:
        "border-rose-300 dark:border-rose-700 bg-card text-rose-700 dark:text-rose-300",
      emptyStateClass:
        "border-rose-200/80 dark:border-rose-800/50 bg-card/80 text-rose-700 dark:text-rose-300",
    },
  },
  ai_review: {
    label: "AI review",
    badgeClassName:
      "border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300",
    laneTheme: {
      boardSurfaceClass:
        "border-indigo-200/90 dark:border-indigo-800/60 bg-indigo-50/55 dark:bg-indigo-950/30",
      headerSurfaceClass: "bg-indigo-50/75 dark:bg-indigo-950/40",
      headerAccentClass: "bg-indigo-500",
      countBadgeClass:
        "border-indigo-300 dark:border-indigo-700 bg-card text-indigo-700 dark:text-indigo-300",
      emptyStateClass:
        "border-indigo-200/80 dark:border-indigo-800/50 bg-card/80 text-indigo-700 dark:text-indigo-300",
    },
  },
  human_review: {
    label: "Human review",
    badgeClassName:
      "border-cyan-200 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300",
    laneTheme: {
      boardSurfaceClass:
        "border-cyan-200/90 dark:border-cyan-800/60 bg-cyan-50/55 dark:bg-cyan-950/30",
      headerSurfaceClass: "bg-cyan-50/75 dark:bg-cyan-950/40",
      headerAccentClass: "bg-cyan-500",
      countBadgeClass:
        "border-cyan-300 dark:border-cyan-700 bg-card text-cyan-700 dark:text-cyan-300",
      emptyStateClass:
        "border-cyan-200/80 dark:border-cyan-800/50 bg-card/80 text-cyan-700 dark:text-cyan-300",
    },
  },
  closed: {
    label: "Done",
    badgeClassName: "border-success-border bg-success-surface text-success-muted",
    laneTheme: {
      boardSurfaceClass:
        "border-emerald-200/90 dark:border-emerald-800/60 bg-emerald-50/55 dark:bg-emerald-950/30",
      headerSurfaceClass: "bg-emerald-50/75 dark:bg-emerald-950/40",
      headerAccentClass: "bg-emerald-500",
      countBadgeClass:
        "border-emerald-300 dark:border-emerald-700 bg-card text-emerald-700 dark:text-emerald-300",
      emptyStateClass:
        "border-emerald-200/80 dark:border-emerald-800/50 bg-card/80 text-emerald-700 dark:text-emerald-300",
    },
  },
  deferred: {
    label: "Deferred",
    badgeClassName: "border-border bg-muted text-muted-foreground",
  },
};

export const statusLabel = (status: TaskCard["status"]): string =>
  TASK_STATUS_PRESENTATION[status].label;

export const statusBadgeClassName = (status: TaskCard["status"]): string =>
  TASK_STATUS_PRESENTATION[status].badgeClassName;

export const laneTheme = (columnId: KanbanColumnId): KanbanLaneTheme =>
  TASK_STATUS_PRESENTATION[columnId].laneTheme ?? DEFAULT_LANE_THEME;
