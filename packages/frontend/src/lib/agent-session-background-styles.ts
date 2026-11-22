import { Hourglass, type LucideIcon } from "lucide-react";

/**
 * The icon of the Background state. It is static: the agent writes no reply, so the state looks
 * calmer than the moving Running dot and spinner.
 */
export const AGENT_SESSION_BACKGROUND_ICON: LucideIcon = Hourglass;

/** The text and icon color of the Background state. */
export const AGENT_SESSION_BACKGROUND_TEXT_CLASS = "text-pending-muted";

/** The status dot fill of the Background state. */
export const AGENT_SESSION_BACKGROUND_DOT_CLASS = "bg-pending-accent";

/** The badge and chip surface of the Background state. */
export const AGENT_SESSION_BACKGROUND_SURFACE_CLASS =
  "border-pending-border bg-pending-surface text-pending-surface-foreground";
