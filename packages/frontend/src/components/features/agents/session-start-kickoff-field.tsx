import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function useSessionStartKickoffDraft({
  requestId,
  open,
  prompt,
}: {
  requestId: string | undefined;
  open: boolean;
  prompt: string | undefined;
}) {
  const [draft, setDraft] = useState<{
    requestId: string | undefined;
    open: boolean;
    enabled: boolean;
    text: string | null;
  }>({ requestId, open, enabled: false, text: null });
  if (draft.requestId !== requestId || draft.open !== open) {
    setDraft({ requestId, open, enabled: false, text: null });
  }
  const hasPrompt = Boolean(prompt?.trim());
  let value: string | undefined;
  if (hasPrompt) value = draft.enabled ? (draft.text ?? "") : prompt;
  return {
    hasPrompt,
    enabled: draft.enabled,
    text: draft.text ?? "",
    invalid: hasPrompt && draft.enabled && !draft.text?.trim(),
    value,
    setEnabled: (enabled: boolean) =>
      setDraft((current) => ({ ...current, enabled, text: current.text ?? prompt ?? "" })),
    setText: (text: string) => setDraft((current) => ({ ...current, text })),
  };
}

export function SessionStartKickoffField({
  draft,
  disabled,
  loading,
  error,
  onRetry,
}: {
  draft: ReturnType<typeof useSessionStartKickoffDraft>;
  disabled: boolean;
  loading: boolean | undefined;
  error: string | null | undefined;
  onRetry: (() => void) | undefined;
}) {
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
                  Kickoff prompt must not be blank.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
