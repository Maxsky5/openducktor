import { AGENT_WORKFLOW_TONE_ICON_CLASSES } from "@/lib/agent-workflow-styles";
import { cn } from "@/lib/utils";
import type {
  SessionNavigationEntry,
  SessionNavigationGroupId,
} from "@/state/read-models/session-navigation-read-model";

export const SESSION_GROUP_ICON_CLASSES = {
  needs_you: "text-warning-accent",
  running: "text-info-accent",
  recent: "text-sidebar-muted-foreground",
} satisfies Record<SessionNavigationGroupId, string>;

export const SESSION_GROUP_COUNT_CLASSES = {
  needs_you: "bg-warning-surface text-warning-muted",
  running: "bg-info-surface text-info-muted",
  recent: "bg-muted text-sidebar-foreground",
} satisfies Record<SessionNavigationGroupId, string>;

/** Task role colors follow the workflow rail. Known attention always keeps its warning cue. */
export const sessionEntryIconClassName = (entry: SessionNavigationEntry): string => {
  if (entry.attention.length > 0) return AGENT_WORKFLOW_TONE_ICON_CLASSES.waiting_input;
  if (entry.status.kind === "checking" || entry.status.kind === "unavailable") {
    return "text-sidebar-muted-foreground";
  }
  if (entry.workflowTone !== null) return AGENT_WORKFLOW_TONE_ICON_CLASSES[entry.workflowTone];
  if (entry.status.kind === "running") return AGENT_WORKFLOW_TONE_ICON_CLASSES.in_progress;
  if (entry.status.failed) return AGENT_WORKFLOW_TONE_ICON_CLASSES.failed;
  return "text-sidebar-muted-foreground";
};

/** A selection strengthens its section's surface instead of replacing its state color. */
export const sessionEntrySurfaceClassName = (
  entry: SessionNavigationEntry,
  selected: boolean,
): string => {
  const frame = "shadow-sm ring-inset focus-visible:ring-3";
  if (entry.attention.length > 0) {
    return cn(
      frame,
      "text-warning-surface-foreground focus-visible:ring-warning-ring",
      selected
        ? "bg-warning-surface-selected ring-3 ring-warning-accent hover:bg-warning-surface-selected"
        : "bg-warning-surface ring-1 ring-warning-border hover:bg-warning-surface-hover",
    );
  }
  if (entry.status.kind === "running") {
    return cn(
      frame,
      "text-info-surface-foreground focus-visible:ring-info-ring",
      selected
        ? "bg-info-surface-selected ring-3 ring-info-accent hover:bg-info-surface-selected"
        : "bg-info-surface ring-1 ring-info-border hover:bg-info-surface-hover",
    );
  }
  return cn(
    frame,
    "text-sidebar-foreground focus-visible:ring-sidebar-ring",
    selected
      ? "bg-secondary ring-3 ring-sidebar-foreground hover:bg-secondary"
      : "bg-sidebar ring-1 ring-sidebar-border hover:bg-muted",
  );
};
