import {
  AGENT_SESSION_BACKGROUND_DOT_CLASS,
  AGENT_SESSION_BACKGROUND_TEXT_CLASS,
} from "@/lib/agent-session-background-styles";
import { AGENT_WORKFLOW_TONE_ICON_CLASSES } from "@/lib/agent-workflow-styles";
import { cn } from "@/lib/utils";
import {
  type SessionEntryDotTone,
  type SessionEntryTitleTone,
  isSessionEntryWaitingOnBackground,
  sessionEntryIconTone,
} from "@openducktor/frontend-core/sessions/navigation/session-entry-presentation";
import type {
  SessionNavigationEntry,
  SessionNavigationGroupId,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";

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

/** The read state dots. A running session shows the running dot instead. */
export const SESSION_DOT_CLASSES = {
  input_unread: "bg-status-input-unread",
  input_read: "bg-status-input-read",
  running: "bg-status-running",
  background: AGENT_SESSION_BACKGROUND_DOT_CLASS,
  unread: "bg-status-unread",
  read: "bg-status-read",
} satisfies Record<SessionEntryDotTone, string>;

/** The title shows attention when the session needs you, and dims when it is read and settled. */
export const SESSION_TITLE_CLASSES = {
  attention: "text-warning-muted",
  read: "text-sidebar-read-foreground",
  default: "text-foreground",
} satisfies Record<SessionEntryTitleTone, string>;

/** Task role colors follow the workflow rail. Known attention always keeps its warning cue. */
export const sessionEntryIconClassName = (entry: SessionNavigationEntry): string => {
  const tone = sessionEntryIconTone(entry);
  if (tone === "muted") return "text-sidebar-muted-foreground";
  if (tone === "background") return AGENT_SESSION_BACKGROUND_TEXT_CLASS;
  return AGENT_WORKFLOW_TONE_ICON_CLASSES[tone];
};

/**
 * A selection strengthens its section's surface instead of replacing its state color. A running
 * session that waits on background tasks keeps a running surface in the calmer violet Background
 * colors.
 */
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
  if (isSessionEntryWaitingOnBackground(entry)) {
    return cn(
      frame,
      "text-pending-surface-foreground focus-visible:ring-pending-ring",
      selected
        ? "bg-pending-surface ring-3 ring-pending-accent hover:bg-pending-surface"
        : "bg-pending-surface ring-1 ring-pending-border hover:bg-pending-surface",
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

/** The surface classes of a session row. */
export const sessionRowClassName = (entry: SessionNavigationEntry, isSelected: boolean): string =>
  cn(
    "relative flex w-full min-w-0 flex-col rounded-md px-2.5 py-1.5 text-left outline-none",
    sessionEntrySurfaceClassName(entry, isSelected),
  );
