import type { JSX } from "react";
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
  return (
    <div className="flex flex-col gap-3">
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
      {draft.enabled ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="session-start-goal" className="text-sm font-medium">
            Goal
          </label>
          <Textarea
            id="session-start-goal"
            value={draft.text}
            disabled={disabled}
            rows={3}
            aria-invalid={draft.error !== null}
            aria-describedby={draft.error ? "session-start-goal-error" : undefined}
            onChange={(event) => draft.setText(event.target.value)}
          />
          {draft.error ? (
            <p id="session-start-goal-error" role="alert" className="text-sm text-destructive">
              {draft.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
