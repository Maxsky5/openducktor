import type { KanbanColumnId } from "@openducktor/core";

type KanbanLaneTheme = {
  boardSurfaceClass: string;
  headerSurfaceClass: string;
  headerAccentClass: string;
  countBadgeClass: string;
  emptyStateClass: string;
};

const DEFAULT_THEME: KanbanLaneTheme = {
  boardSurfaceClass: "border-border/90 bg-muted/55",
  headerSurfaceClass: "bg-muted/70",
  headerAccentClass: "bg-muted/0",
  countBadgeClass: "border-input bg-card text-foreground",
  emptyStateClass: "border-input/80 bg-card/70 text-muted-foreground",
};

const KANBAN_LANE_THEMES: Record<KanbanColumnId, KanbanLaneTheme> = {
  open: {
    boardSurfaceClass: "border-border/90 bg-muted/60",
    headerSurfaceClass: "bg-muted/80",
    headerAccentClass: "bg-muted/0",
    countBadgeClass: "border-input bg-card text-foreground",
    emptyStateClass: "border-input/80 bg-card/80 text-muted-foreground",
  },
  spec_ready: {
    boardSurfaceClass: "border-violet-200/90 bg-violet-50/55",
    headerSurfaceClass: "bg-violet-50/75",
    headerAccentClass: "bg-violet-500",
    countBadgeClass: "border-violet-300 bg-card text-violet-700",
    emptyStateClass: "border-violet-200/80 bg-card/80 text-violet-600",
  },
  ready_for_dev: {
    boardSurfaceClass: "border-sky-200/90 bg-sky-50/55",
    headerSurfaceClass: "bg-sky-50/75",
    headerAccentClass: "bg-sky-500",
    countBadgeClass: "border-sky-300 bg-card text-sky-700",
    emptyStateClass: "border-sky-200/80 bg-card/80 text-sky-700",
  },
  in_progress: {
    boardSurfaceClass: "border-amber-200/90 bg-amber-50/55",
    headerSurfaceClass: "bg-amber-50/75",
    headerAccentClass: "bg-amber-500",
    countBadgeClass: "border-amber-300 bg-card text-amber-700",
    emptyStateClass: "border-amber-200/80 bg-card/80 text-amber-700",
  },
  blocked: {
    boardSurfaceClass: "border-rose-200/90 bg-rose-50/55",
    headerSurfaceClass: "bg-rose-50/75",
    headerAccentClass: "bg-rose-500",
    countBadgeClass: "border-rose-300 bg-card text-rose-700",
    emptyStateClass: "border-rose-200/80 bg-card/80 text-rose-700",
  },
  ai_review: {
    boardSurfaceClass: "border-indigo-200/90 bg-indigo-50/55",
    headerSurfaceClass: "bg-indigo-50/75",
    headerAccentClass: "bg-indigo-500",
    countBadgeClass: "border-indigo-300 bg-card text-indigo-700",
    emptyStateClass: "border-indigo-200/80 bg-card/80 text-indigo-700",
  },
  human_review: {
    boardSurfaceClass: "border-cyan-200/90 bg-cyan-50/55",
    headerSurfaceClass: "bg-cyan-50/75",
    headerAccentClass: "bg-cyan-500",
    countBadgeClass: "border-cyan-300 bg-card text-cyan-700",
    emptyStateClass: "border-cyan-200/80 bg-card/80 text-cyan-700",
  },
  closed: {
    boardSurfaceClass: "border-emerald-200/90 bg-emerald-50/55",
    headerSurfaceClass: "bg-emerald-50/75",
    headerAccentClass: "bg-emerald-500",
    countBadgeClass: "border-emerald-300 bg-card text-emerald-700",
    emptyStateClass: "border-emerald-200/80 bg-card/80 text-emerald-700",
  },
};

export const laneTheme = (columnId: KanbanColumnId): KanbanLaneTheme =>
  KANBAN_LANE_THEMES[columnId] ?? DEFAULT_THEME;
