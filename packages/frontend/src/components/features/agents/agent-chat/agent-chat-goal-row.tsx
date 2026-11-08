import type { AgentSessionGoalControlAction, AgentSessionGoalStatus } from "@openducktor/contracts";
import {
  AGENT_SESSION_GOAL_ACTION_LABELS,
  type AgentSessionGoalTone,
} from "@openducktor/frontend-core/sessions/goals/agent-session-goal-row";
import type { AgentSessionGoalRowModel } from "@openducktor/frontend-core/sessions/goals/use-agent-session-goal-row";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePause,
  LoaderCircle,
  Pause,
  Play,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";
import { type ReactElement, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { CssPresenceList, useCssPresence } from "@/components/ui/css-presence";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CardIconButton } from "./agent-chat-queued-message-stack";
import { cn } from "@/lib/utils";

const TONE_CLASS_NAMES = {
  success: "text-success-muted",
  warning: "text-warning-muted",
  danger: "text-destructive-muted",
  info: "text-info-muted",
  muted: "text-muted-foreground",
} satisfies Record<AgentSessionGoalTone, string>;

const STATUS_ICONS = {
  active: Target,
  paused: CirclePause,
  blocked: CircleAlert,
  limit_reached: CircleAlert,
  complete: CircleCheck,
  waiting_for_message: CirclePause,
  ended: CircleDashed,
} satisfies Record<AgentSessionGoalStatus, LucideIcon>;

const ACTION_ICONS = {
  pause: Pause,
  resume: Play,
  clear: X,
} satisfies Record<AgentSessionGoalControlAction, LucideIcon>;

/**
 * The goal of the session on the top edge of the composer. It shows the goal that the runtime
 * reports, with its status, its objective on one line, and the actions of the runtime.
 */
export function AgentChatGoalRow({
  model,
  scope,
}: {
  model: AgentSessionGoalRowModel | null;
  /** The session and its live presence. A new scope shows its goal at once. */
  scope: string | null;
}): ReactElement {
  return (
    // Another chat, or a session that becomes attached, shows its known goal at once. Only
    // later changes animate.
    <CssPresenceList key={scope ?? "none"}>
      {model ? [<GoalRowCard key="goal" model={model} />] : []}
    </CssPresenceList>
  );
}

function GoalRowCard({ model }: { model: AgentSessionGoalRowModel }): ReactElement {
  const { presenceProps } = useCssPresence();
  const lineRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  // The ellipsis waits until the line has closed, so the words do not jump while it shrinks.
  const [clamped, setClamped] = useState(true);
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (expanded || !line) return;
    let interrupted = false;
    void Promise.allSettled(line.getAnimations().map((animation) => animation.finished)).then(
      () => {
        if (!interrupted) setClamped(true);
      },
    );
    return () => {
      interrupted = true;
    };
  }, [expanded]);
  const truncated = useIsTruncated(lineRef, clamped, `${model.statusLabel} ${model.objective}`);
  const expandable = expanded || truncated;
  const StatusIcon = STATUS_ICONS[model.status];
  const toneClassName = TONE_CLASS_NAMES[model.tone];

  return (
    <TooltipProvider disableHoverableContent>
      <section
        aria-label="Goal"
        {...presenceProps}
        className="css-presence goal-row relative z-[45] mx-3"
      >
        <div className="rounded-t-xl border border-b-0 border-input bg-chat-surface px-3 pt-2 pb-3.5 text-[13px] leading-5 text-muted-foreground shadow-xs">
          <div className="flex items-start gap-1">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start gap-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
              aria-expanded={expandable ? expanded : undefined}
              disabled={!expandable}
              onClick={() => {
                if (!expanded) setClamped(false);
                setExpanded(!expanded);
              }}
            >
              <span
                ref={lineRef}
                className="goal-row-line min-w-0 flex-1"
                data-expanded={expanded}
                data-clamped={clamped}
              >
                <StatusIcon
                  className={cn("goal-row-icon mr-1.5 inline-block size-3.5", toneClassName)}
                  aria-hidden="true"
                />
                <span className="font-medium text-foreground">Goal</span>{" "}
                <span className={cn("goal-row-status ml-1 font-medium", toneClassName)}>
                  {model.statusLabel}
                </span>{" "}
                <span className="ml-1 text-foreground/90">{model.objective}</span>
              </span>
              {expandable ? (
                <ChevronDown
                  className="goal-row-chevron mt-[3px] size-3.5 shrink-0"
                  data-expanded={expanded}
                  aria-hidden="true"
                />
              ) : null}
            </button>
            <div className="-my-0.5 flex shrink-0 items-center gap-0.5">
              {model.actions.map((action) => {
                const Icon = model.pendingAction === action ? LoaderCircle : ACTION_ICONS[action];
                return (
                  <CardIconButton
                    key={action}
                    label={`${AGENT_SESSION_GOAL_ACTION_LABELS[action]} goal`}
                    disabled={model.pendingAction !== null}
                    onClick={() => model.onAction(action)}
                  >
                    <Icon
                      className={cn("size-3.5", model.pendingAction === action && "animate-spin")}
                      aria-hidden="true"
                    />
                  </CardIconButton>
                );
              })}
            </div>
          </div>
          {model.detail ? <p className="mt-0.5 pl-5 text-xs">{model.detail}</p> : null}
          {model.error ? (
            <p role="alert" className="mt-0.5 pl-5 text-xs text-destructive">
              {model.error}
            </p>
          ) : null}
        </div>
      </section>
    </TooltipProvider>
  );
}

/** Tells if a clamped line cuts its text, so the row offers to expand only then. */
function useIsTruncated(
  ref: RefObject<HTMLElement | null>,
  clamped: boolean,
  text: string,
): boolean {
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !clamped) return;
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // A new text can cut the line without a size change.
  }, [clamped, ref, text]);
  return truncated;
}
