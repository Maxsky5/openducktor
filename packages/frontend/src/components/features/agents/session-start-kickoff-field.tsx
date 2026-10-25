import type { JSX } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  BLANK_KICKOFF_PROMPT_ERROR,
  type SessionStartKickoffDraft,
} from "@openducktor/frontend-core/sessions/start/use-session-start-kickoff-draft";

type SessionStartKickoffFieldProps = {
  draft: SessionStartKickoffDraft;
  disabled: boolean;
  loading: boolean | undefined;
  error: string | null | undefined;
  onRetry: (() => void) | undefined;
};

export function SessionStartKickoffField({
  draft,
  disabled,
  loading,
  error,
  onRetry,
}: SessionStartKickoffFieldProps): JSX.Element {
  return (
    <>
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading kickoff prompt...
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="text-sm text-destructive">
          {error}
          <Button type="button" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
      {draft.hasPrompt ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="customize-kickoff"
              checked={draft.enabled}
              disabled={disabled}
              onCheckedChange={draft.setEnabled}
            />
            <label htmlFor="customize-kickoff" className="text-sm font-medium">
              Customize kickoff prompt
            </label>
          </div>
          {draft.enabled ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="kickoff-prompt" className="text-sm font-medium">
                Kickoff prompt
              </label>
              <Textarea
                id="kickoff-prompt"
                value={draft.text}
                disabled={disabled}
                rows={8}
                aria-invalid={draft.invalid}
                aria-describedby={draft.invalid ? "kickoff-prompt-error" : undefined}
                onChange={(event) => draft.setText(event.target.value)}
              />
              {draft.invalid ? (
                <p id="kickoff-prompt-error" role="alert" className="text-sm text-destructive">
                  {BLANK_KICKOFF_PROMPT_ERROR}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
