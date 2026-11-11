import {
  TOOL_LIFECYCLE_LABELS,
  type ToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import {
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock3,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { toolIcon } from "./agent-chat-tool-icon";
import { ToolRunningBars } from "./agent-chat-tool-message-timing";
import { useValueAtMount } from "./use-value-at-mount";
import "./agent-chat-tool-run.css";

type ToolStatus = {
  label: string;
  /** Null for a running call, which shows moving bars. */
  Icon: LucideIcon | null;
  iconClassName: string;
  textClassName: string;
};

const PENDING_STATUS = {
  Icon: Clock3,
  iconClassName: "text-muted-foreground",
  textClassName: "text-muted-foreground",
};

/** The label, icon, and colors of each phase of a tool call. */
export const TOOL_STATUS = {
  preparing: { label: TOOL_LIFECYCLE_LABELS.preparing, ...PENDING_STATUS },
  queued: { label: TOOL_LIFECYCLE_LABELS.queued, ...PENDING_STATUS },
  executing: {
    label: TOOL_LIFECYCLE_LABELS.executing,
    Icon: null,
    iconClassName: "text-status-running-foreground",
    textClassName: "text-status-running-foreground",
  },
  completed: {
    label: TOOL_LIFECYCLE_LABELS.completed,
    Icon: CircleCheck,
    iconClassName: "text-success-icon",
    textClassName: "text-success-muted",
  },
  failed: {
    label: TOOL_LIFECYCLE_LABELS.failed,
    Icon: CircleX,
    iconClassName: "text-destructive-accent",
    textClassName: "text-destructive-muted",
  },
  cancelled: {
    label: TOOL_LIFECYCLE_LABELS.cancelled,
    Icon: CircleSlash,
    iconClassName: "text-cancelled-accent",
    textClassName: "text-cancelled-muted",
  },
} as const satisfies Record<ToolLifecyclePhase, ToolStatus>;

/**
 * The icon of the phase of a tool call, with its label for screen readers. A `decorative` icon
 * sits next to its visible label, so screen readers skip it.
 */
export const ToolStatusIcon = ({
  phase,
  decorative = false,
  className,
}: {
  phase: ToolLifecyclePhase;
  decorative?: boolean;
  className?: string;
}): ReactElement => {
  const { label, Icon, iconClassName } = TOOL_STATUS[phase];
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center",
        iconClassName,
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : <ToolRunningBars />}
    </span>
  );
};

/**
 * The colors of the icon of a call in its row by status. A call that succeeded keeps the color of
 * the other tool icons, so only running, failed, and cancelled calls stand out.
 */
const TOOL_CALL_ICON_COLORS = {
  preparing: "text-muted-foreground/60",
  queued: "text-muted-foreground/60",
  executing: "text-status-running-foreground",
  completed: "text-muted-foreground",
  failed: "text-destructive-muted",
  cancelled: "text-cancelled-muted",
} as const satisfies Record<ToolLifecyclePhase, string>;

type ToolCallGlyph = "spinner" | "bars" | "tool";

const readToolCallGlyph = (phase: ToolLifecyclePhase): ToolCallGlyph => {
  if (phase === "executing") return "bars";
  if (phase === "preparing") return "spinner";
  return "tool";
};

const renderToolCallGlyph = (glyph: ToolCallGlyph, meta: ToolMeta): ReactElement => {
  if (glyph === "bars") return <ToolRunningBars />;
  if (glyph === "spinner") {
    return (
      <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
    );
  }
  return toolIcon(meta);
};

/**
 * The icon of a call in its tool row: the icon of its tool, in the color of its status. A spinner
 * takes its place while the agent writes the call, and moving bars while the call runs. A new
 * icon fades and grows in, and its color changes with a short transition. Screen readers read the
 * status.
 */
export const ToolCallIcon = ({
  meta,
  phase,
}: {
  meta: ToolMeta;
  phase: ToolLifecyclePhase;
}): ReactElement => {
  const glyph = readToolCallGlyph(phase);
  const mountGlyph = useValueAtMount(glyph);
  return (
    <span
      role="img"
      aria-label={TOOL_STATUS[phase].label}
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center transition-colors duration-200 motion-reduce:transition-none",
        TOOL_CALL_ICON_COLORS[phase],
      )}
    >
      <span
        key={glyph}
        className={cn(
          "inline-flex items-center justify-center",
          glyph !== mountGlyph && "tool-call-icon-swap-in",
        )}
      >
        {renderToolCallGlyph(glyph, meta)}
      </span>
    </span>
  );
};
