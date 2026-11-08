import type { AgentSessionGoalControlAction } from "@openducktor/contracts";
import {
  AGENT_SESSION_GOAL_ACTION_LABELS,
  type AgentSessionGoalTone,
} from "@openducktor/frontend-core/sessions/goals/agent-session-goal-row";
import type { AgentSessionGoalRowModel } from "@openducktor/frontend-core/sessions/goals/use-agent-session-goal-row";
import { ChevronDown, LoaderCircle, Pause, Play, Target, X } from "lucide-react";
import { type ReactElement, useId, useLayoutEffect, useRef, useState } from "react";
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

const ACTION_ICONS = {
  pause: Pause,
  resume: Play,
  clear: X,
} satisfies Record<AgentSessionGoalControlAction, typeof Pause>;

/**
 * The goal of the session on the top edge of the composer. It shows the goal that the runtime
 * reports, with its status, its objective on one line, and the actions of the runtime.
 */
export function AgentChatGoalRow({
  model,
  sessionKey,
}: {
  model: AgentSessionGoalRowModel | null;
  sessionKey: string | null;
}): ReactElement {
  return (
    // Another chat shows its goal at once. Only later changes animate.
    <CssPresenceList key={sessionKey ?? "none"}>
      {model ? [<GoalRowCard key="goal" model={model} />] : []}
    </CssPresenceList>
  );
}

function GoalRowCard({ model }: { model: AgentSessionGoalRowModel }): ReactElement {
  const { presenceProps } = useCssPresence();
  const objectiveId = useId();
  const objectiveRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  // The ellipsis waits until the objective has closed, so the lines do not jump while it shrinks.
  const [clamped, setClamped] = useState(true);
  useLayoutEffect(() => {
    const objective = objectiveRef.current;
    if (expanded || !objective) return;
    let interrupted = false;
    void Promise.allSettled(objective.getAnimations().map((animation) => animation.finished)).then(
      () => {
        if (!interrupted) setClamped(true);
      },
    );
    return () => {
      interrupted = true;
    };
  }, [expanded]);

  return (
    <TooltipProvider disableHoverableContent>
      <section
        aria-label="Goal"
        {...presenceProps}
        className="css-presence goal-row relative z-[45] mx-3"
      >
        <div className="rounded-t-xl border border-b-0 border-input bg-chat-surface px-3 pt-2 pb-3.5 text-[13px] leading-5 text-muted-foreground shadow-xs">
          <div className="flex items-start gap-2">
            <Target className="mt-[3px] size-3.5 shrink-0" aria-hidden="true" />
            <span className="shrink-0 font-medium text-foreground">Goal</span>
            <span
              className={cn("goal-row-status shrink-0 font-medium", TONE_CLASS_NAMES[model.tone])}
            >
              {model.statusLabel}
            </span>
            <button
              type="button"
              className="group flex min-w-0 flex-1 items-start gap-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
              aria-expanded={expanded}
              aria-controls={objectiveId}
              aria-label={expanded ? "Show less of the goal" : "Show the whole goal"}
              onClick={() => {
                if (!expanded) setClamped(false);
                setExpanded(!expanded);
              }}
            >
              <span
                ref={objectiveRef}
                id={objectiveId}
                className="goal-row-objective min-w-0 flex-1 text-foreground/90"
                data-expanded={expanded}
                data-clamped={clamped}
              >
                {model.objective}
              </span>
              <ChevronDown
                className="goal-row-chevron mt-[3px] size-3.5 shrink-0"
                data-expanded={expanded}
                aria-hidden="true"
              />
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
          {model.detail ? <p className="mt-0.5 pl-[22px] text-xs">{model.detail}</p> : null}
          {model.error ? (
            <p role="alert" className="mt-0.5 pl-[22px] text-xs text-destructive">
              {model.error}
            </p>
          ) : null}
        </div>
      </section>
    </TooltipProvider>
  );
}
