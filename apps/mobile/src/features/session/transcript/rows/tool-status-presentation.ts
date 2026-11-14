import {
  TOOL_LIFECYCLE_LABELS,
  type ToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import type { AppTheme } from "@/theme/tokens";
import type { IconName } from "@/ui/icon";

type ToolStatus = {
  label: string;
  /** Null for a running call, which shows a spinner. */
  icon: IconName | null;
  color: (desktop: AppTheme["desktop"]) => string;
  textColor: (desktop: AppTheme["desktop"]) => string;
};

const PENDING_STATUS = {
  icon: "clock",
  color: (desktop) => desktop.mutedForeground,
  textColor: (desktop) => desktop.mutedForeground,
} as const satisfies Omit<ToolStatus, "label">;

/** The desktop `TOOL_STATUS`: the label, icon, and colors of each phase of a tool call. */
export const TOOL_STATUS = {
  preparing: { label: TOOL_LIFECYCLE_LABELS.preparing, ...PENDING_STATUS },
  queued: { label: TOOL_LIFECYCLE_LABELS.queued, ...PENDING_STATUS },
  executing: {
    label: TOOL_LIFECYCLE_LABELS.executing,
    icon: null,
    color: (desktop) => desktop.statusRunningForeground,
    textColor: (desktop) => desktop.statusRunningForeground,
  },
  completed: {
    label: TOOL_LIFECYCLE_LABELS.completed,
    icon: "circle-check",
    color: (desktop) => desktop.successIcon,
    textColor: (desktop) => desktop.successMuted,
  },
  failed: {
    label: TOOL_LIFECYCLE_LABELS.failed,
    icon: "x-circle-fill",
    color: (desktop) => desktop.destructiveAccent,
    textColor: (desktop) => desktop.destructiveMuted,
  },
  cancelled: {
    label: TOOL_LIFECYCLE_LABELS.cancelled,
    icon: "circle-slash",
    color: (desktop) => desktop.cancelledAccent,
    textColor: (desktop) => desktop.cancelledMuted,
  },
} as const satisfies Record<ToolLifecyclePhase, ToolStatus>;

/** What a call does now: the agent prepares it, it runs, or it ended. */
export type ToolActivity = "preparing" | "running" | null;

/** The desktop activity of a call in each phase, for its timing and its card. */
export const toolActivity = (phase: ToolLifecyclePhase): ToolActivity => {
  if (phase === "executing") return "running";
  if (phase === "preparing") return "preparing";
  return null;
};
