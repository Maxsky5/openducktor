import type { AgentSessionGoalControlAction, AgentSessionGoalStatus } from "@openducktor/contracts";
import { AGENT_SESSION_GOAL_ACTION_LABELS } from "@openducktor/frontend-core/sessions/goals/agent-session-goal-row";
import type { AgentSessionGoalRowModel } from "@openducktor/frontend-core/sessions/goals/use-agent-session-goal-row";
import { ChevronDown, LoaderCircle, Pause, Play, Target, X } from "lucide-react";
import { type ReactElement, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STATUS_CLASS_NAMES = {
  active: "text-emerald-700 dark:text-emerald-400",
  paused: "text-amber-700 dark:text-amber-400",
  blocked: "text-rose-700 dark:text-rose-400",
  limit_reached: "text-rose-700 dark:text-rose-400",
  complete: "text-emerald-700 dark:text-emerald-400",
  waiting_for_message: "text-sky-700 dark:text-sky-400",
  ended: "text-muted-foreground",
} satisfies Record<AgentSessionGoalStatus, string>;

const ACTION_ICONS = {
  pause: Pause,
  resume: Play,
  clear: X,
} satisfies Record<AgentSessionGoalControlAction, typeof Pause>;

/**
 * The goal of the session on the top edge of the composer. It shows the goal that the runtime
 * reports, with its status, its objective on one line, and the actions of the runtime.
 */
export function AgentChatGoalRow({ model }: { model: AgentSessionGoalRowModel }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const objectiveId = useId();
  return (
    <TooltipProvider disableHoverableContent>
      <section aria-label="Goal" className="relative z-[45] mx-3 -mb-1.5">
        <div className="rounded-t-xl border border-b-0 border-input bg-chat-surface px-3 pt-2 pb-3.5 text-[13px] leading-5 text-muted-foreground shadow-xs">
          <div className="flex items-start gap-2">
            <Target className="mt-[3px] size-3.5 shrink-0" aria-hidden="true" />
            <span className="shrink-0 font-medium text-foreground">Goal</span>
            <span className={cn("shrink-0 font-medium", STATUS_CLASS_NAMES[model.status])}>
              {model.statusLabel}
            </span>
            <button
              type="button"
              className="group flex min-w-0 flex-1 items-start gap-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
              aria-expanded={expanded}
              aria-controls={objectiveId}
              aria-label={expanded ? "Show less of the goal" : "Show the whole goal"}
              onClick={() => setExpanded((current) => !current)}
            >
              <span
                id={objectiveId}
                className={cn(
                  "min-w-0 flex-1 text-foreground/90",
                  expanded ? "whitespace-pre-wrap break-words" : "truncate",
                )}
              >
                {model.objective}
              </span>
              <ChevronDown
                className={cn(
                  "mt-[3px] size-3.5 shrink-0 transition-transform duration-150",
                  expanded && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
            <div className="-my-0.5 flex shrink-0 items-center gap-0.5">
              {model.actions.map((action) => (
                <GoalActionButton
                  key={action}
                  action={action}
                  pending={model.pendingAction === action}
                  disabled={model.pendingAction !== null}
                  onClick={() => model.onAction(action)}
                />
              ))}
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

function GoalActionButton({
  action,
  pending,
  disabled,
  onClick,
}: {
  action: AgentSessionGoalControlAction;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}): ReactElement {
  const label = `${AGENT_SESSION_GOAL_ACTION_LABELS[action]} goal`;
  const Icon = pending ? LoaderCircle : ACTION_ICONS[action];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button gets no pointer events, so the wrapper shows the tooltip. */}
        <span className="inline-flex">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={label}
            aria-busy={pending ? true : undefined}
            disabled={disabled}
            onClick={onClick}
          >
            <Icon className={cn("size-3.5", pending && "animate-spin")} aria-hidden="true" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
