import { LoaderCircle, Sparkles } from "lucide-react";
import type { JSX } from "react";
import { Button } from "@/components/ui/button";
import { CssPresenceReveal } from "@/components/ui/css-presence-reveal";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SessionStartGoalDraft } from "@openducktor/frontend-core/sessions/start/use-session-start-goal-draft";

/** The Goal mode switch of a launch that offers it, and the goal text when it is on. */
export function SessionStartGoalField({
  draft,
  disabled,
}: {
  draft: SessionStartGoalDraft;
  disabled: boolean;
}): JSX.Element | null {
  if (!draft.offered) return null;
  const unavailable = draft.unavailableReason !== null;
  const { generation } = draft;
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Switch
            id="session-start-goal-mode"
            checked={draft.enabled}
            disabled={disabled || unavailable}
            aria-describedby={unavailable ? "session-start-goal-unavailable" : undefined}
            onCheckedChange={draft.setEnabled}
          />
          <label htmlFor="session-start-goal-mode" className="text-sm font-medium">
            Goal mode
          </label>
        </div>
        {unavailable ? (
          <p id="session-start-goal-unavailable" className="text-sm text-muted-foreground">
            {draft.unavailableReason}
          </p>
        ) : null}
      </div>
      <CssPresenceReveal open={draft.enabled} className="flex flex-col gap-1.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="session-start-goal" className="text-sm font-medium">
            Goal
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || generation.running || generation.unavailableReason !== null}
            aria-describedby={
              generation.unavailableReason ? "session-start-goal-generation-unavailable" : undefined
            }
            onClick={generation.start}
          >
            {generation.running ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {generation.running ? "Generating goal…" : "Generate goal"}
          </Button>
        </div>
        <p id="session-start-goal-hint" className="text-sm text-muted-foreground">
          The agent gets this goal instead of a first message, and works until the goal is met.
        </p>
        {generation.unavailableReason ? (
          <p
            id="session-start-goal-generation-unavailable"
            className="text-sm text-muted-foreground"
          >
            {generation.unavailableReason}
          </p>
        ) : null}
        <Textarea
          id="session-start-goal"
          value={draft.text}
          disabled={disabled || generation.running}
          rows={11}
          aria-invalid={draft.error !== null}
          aria-describedby={
            draft.error
              ? "session-start-goal-hint session-start-goal-error"
              : "session-start-goal-hint"
          }
          onChange={(event) => draft.setText(event.target.value)}
        />
        {draft.error ? (
          <p id="session-start-goal-error" role="alert" className="text-sm text-destructive">
            {draft.error}
          </p>
        ) : null}
        {generation.error ? (
          <p role="alert" className="text-sm text-destructive">
            {generation.error}
          </p>
        ) : null}
      </CssPresenceReveal>
    </div>
  );
}
