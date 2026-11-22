import { plural } from "@openducktor/frontend-core/lib/plural";
import {
  BACKGROUND_TASKS_LABEL,
  type BackgroundTaskRow,
} from "@openducktor/frontend-core/sessions/background-tasks/background-task-bar";
import type { SessionBackgroundTasksModel } from "@openducktor/frontend-core/sessions/background-tasks/use-session-background-tasks";
import { ChevronDown, LoaderCircle, Square } from "lucide-react";
import { memo, type ReactElement, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CssPresenceList, useCssPresence } from "@/components/ui/css-presence";
import { CssPresenceReveal } from "@/components/ui/css-presence-reveal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AGENT_SESSION_BACKGROUND_ICON,
  AGENT_SESSION_BACKGROUND_TEXT_CLASS,
} from "@/lib/agent-session-background-styles";
import { cn } from "@/lib/utils";

/**
 * The running background tasks of the session, on the top edge of the composer. It shows their
 * count, and it opens to list each task with its Stop control.
 */
// The composer renders on each keystroke, and the model and the scope keep their identity.
export const AgentChatBackgroundTaskBar = memo(function AgentChatBackgroundTaskBar({
  model,
  scope,
}: {
  model: SessionBackgroundTasksModel | null;
  /** The session. A new scope shows its bar at once. Only later changes animate. */
  scope: string | null;
}): ReactElement {
  return (
    <CssPresenceList key={scope ?? "none"}>
      {model ? [<BackgroundTaskBarCard key="background-tasks" model={model} />] : []}
    </CssPresenceList>
  );
});

function BackgroundTaskBarCard({ model }: { model: SessionBackgroundTasksModel }): ReactElement {
  const { presenceProps } = useCssPresence();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const BackgroundIcon = AGENT_SESSION_BACKGROUND_ICON;
  return (
    <section
      aria-label={BACKGROUND_TASKS_LABEL}
      {...presenceProps}
      className="css-presence background-task-bar relative z-[44] mx-3"
    >
      <div className="rounded-t-xl border border-b-0 border-input bg-chat-surface px-3 pt-2 pb-3.5 text-[13px] leading-5 text-muted-foreground shadow-xs">
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-1.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          onClick={() => setExpanded(!expanded)}
        >
          <BackgroundIcon
            className={cn("size-3.5 shrink-0", AGENT_SESSION_BACKGROUND_TEXT_CLASS)}
            aria-hidden="true"
          />
          <span className="font-medium text-foreground">{BACKGROUND_TASKS_LABEL}</span>
          <span className="min-w-0 flex-1 truncate">
            {plural(model.rows.length, "background task")}
          </span>
          <ChevronDown
            className="goal-row-chevron size-3.5 shrink-0"
            data-expanded={expanded}
            aria-hidden="true"
          />
        </button>
        <CssPresenceReveal open={expanded} className="pt-1.5">
          <ul id={listId} className="max-h-60 divide-y divide-border overflow-y-auto">
            {model.rows.map((row) => (
              <BackgroundTaskRowItem key={row.taskId} row={row} onStop={model.onStop} />
            ))}
          </ul>
        </CssPresenceReveal>
      </div>
    </section>
  );
}

const BackgroundTaskRowItem = memo(function BackgroundTaskRowItem({
  row,
  onStop,
}: {
  row: BackgroundTaskRow;
  onStop: (taskId: string) => void;
}): ReactElement {
  return (
    <li className="flex items-start gap-2 py-1.5" data-testid="background-task-row">
      <Badge variant="outline" className="mt-px shrink-0 px-1.5 py-0 text-[11px] leading-4">
        {row.kindLabel}
      </Badge>
      <div className="min-w-0 flex-1">
        <BackgroundTaskText row={row} />
        <BackgroundTaskStopNote row={row} />
      </div>
      <BackgroundTaskStopControl row={row} onStop={onStop} />
    </li>
  );
});

/**
 * The text and description of a task on one line each. A click, Enter, or Space shows all of it,
 * whatever the state of its Stop control.
 */
function BackgroundTaskText({ row }: { row: BackgroundTaskRow }): ReactElement {
  const [open, setOpen] = useState(false);
  const lineClass = open ? "whitespace-pre-wrap break-words" : "truncate";
  return (
    <button
      type="button"
      className="block w-full min-w-0 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <span className={cn("block text-foreground", lineClass)}>{row.title}</span>
      {row.description ? (
        <span className={cn("block text-xs", lineClass)}>{row.description}</span>
      ) : null}
    </button>
  );
}

/** Why a task cannot stop, or why its last Stop failed. */
function BackgroundTaskStopNote({ row }: { row: BackgroundTaskRow }): ReactElement | null {
  const { note } = row.stop;
  if (!note) return null;
  return note.tone === "error" ? (
    <p role="alert" className="text-xs break-words text-destructive">
      {note.text}
    </p>
  ) : (
    <p className="text-xs break-words text-muted-foreground">{note.text}</p>
  );
}

function BackgroundTaskStopControl({
  row,
  onStop,
}: {
  row: BackgroundTaskRow;
  onStop: (taskId: string) => void;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const { control } = row.stop;
  if (!control) return null;
  if (control.busy) {
    return (
      <Button type="button" size="xs" variant="ghost" className="shrink-0" disabled>
        <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
        {control.label}
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Stop ${row.kindLabel.toLowerCase()} ${row.title}`}
        >
          <Square className="size-3" aria-hidden="true" />
          Stop
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-72 p-3"
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <p id={titleId} className="text-sm font-medium text-foreground">
          {row.confirmation.title}
        </p>
        <p id={descriptionId} className="mt-1 text-xs break-words text-muted-foreground">
          {row.confirmation.description}
        </p>
        <div className="mt-3 flex justify-between gap-2">
          <Button type="button" size="xs" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="xs"
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onStop(row.taskId);
            }}
          >
            <Square className="size-3" aria-hidden="true" />
            {row.confirmation.confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
