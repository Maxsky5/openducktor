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
        {/* One field: the goal text and its footer share one border and one focus. */}
        <div
          className="flex flex-col overflow-hidden rounded-md border border-input bg-card shadow-sm transition-colors has-[textarea:focus-visible]:border-ring has-aria-invalid:border-destructive"
          data-testid="session-start-goal-input-group"
        >
          <Textarea
            embedded
            id="session-start-goal"
            aria-label="Goal"
            value={draft.text}
            disabled={disabled || draft.generation.running}
            rows={11}
            className="resize-none"
            aria-invalid={draft.error !== null}
            aria-describedby={
              draft.error
                ? "session-start-goal-hint session-start-goal-error"
                : "session-start-goal-hint"
            }
            onChange={(event) => draft.setText(event.target.value)}
          />
          <div className="flex items-center justify-between gap-3 border-t border-input bg-muted/40 px-3 py-2">
            {/* Without a default model, the footer names the fix of the disabled button. */}
            <p id="session-start-goal-hint" className="text-xs text-muted-foreground">
              {draft.generation.unavailableReason ??
                "The agent gets this goal instead of a first message, and works until it is met."}
            </p>
            <GenerateGoalButton generation={draft.generation} disabled={disabled} />
          </div>
        </div>
        {draft.error ? (
          <p id="session-start-goal-error" role="alert" className="text-sm text-destructive">
            {draft.error}
          </p>
        ) : null}
        {draft.generation.error ? (
          <p role="alert" className="text-sm text-destructive">
            {draft.generation.error}
          </p>
        ) : null}
      </CssPresenceReveal>
    </div>
  );
}

/** Asks an agent to write the goal. */
function GenerateGoalButton({
  generation,
  disabled,
}: {
  generation: SessionStartGoalDraft["generation"];
  disabled: boolean;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="shrink-0"
      disabled={disabled || generation.running || generation.unavailableReason !== null}
      onClick={generation.start}
    >
      {generation.running ? (
        <>
          <LoaderCircle className="size-3.5 animate-spin" />
          Generating goal…
        </>
      ) : (
        <>
          <Sparkles className="size-3.5" />
          Generate goal
        </>
      )}
    </Button>
  );
}
