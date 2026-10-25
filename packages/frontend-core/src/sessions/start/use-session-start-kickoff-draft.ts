import { useState } from "react";

export const BLANK_KICKOFF_PROMPT_ERROR = "Kickoff prompt must not be blank.";

/** The kickoff prompt that the user can change before a start. */
export type SessionStartKickoffDraft = {
  hasPrompt: boolean;
  enabled: boolean;
  text: string;
  invalid: boolean;
  /** The prompt that the start sends, or undefined when the launch has no kickoff prompt. */
  value: string | undefined;
  setEnabled: (enabled: boolean) => void;
  setText: (text: string) => void;
};

/** A new request or a new open resets the draft to the resolved prompt. */
export function useSessionStartKickoffDraft({
  requestId,
  open,
  prompt,
}: {
  requestId: string | undefined;
  open: boolean;
  prompt: string | undefined;
}): SessionStartKickoffDraft {
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
