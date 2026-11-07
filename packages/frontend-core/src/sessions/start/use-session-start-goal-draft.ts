import { AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH } from "@openducktor/contracts";
import { useState } from "react";
import type { SessionStartGoalMode } from "./session-start-modal-model";

export const BLANK_GOAL_ERROR = "Enter a goal.";

/** The Goal mode switch and goal text of a start form. */
export type SessionStartGoalDraft = {
  /** The launch offers Goal mode. */
  offered: boolean;
  /** Why the selected runtime cannot use Goal mode, or null. */
  unavailableReason: string | null;
  enabled: boolean;
  text: string;
  /** Why the start cannot use the goal text, or null. */
  error: string | null;
  /** The goal objective that the start sets, or undefined with Goal mode off. */
  value: string | undefined;
  setEnabled: (enabled: boolean) => void;
  setText: (text: string) => void;
};

const goalTextError = (text: string): string | null => {
  const objective = text.trim();
  if (!objective) return BLANK_GOAL_ERROR;
  if (objective.length > AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH)
    return `A goal can have at most ${AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH} characters. This one has ${objective.length}.`;
  return null;
};

/** Goal mode is off each time the form opens. Turning it on fills the default goal text. */
export function useSessionStartGoalDraft({
  requestId,
  open,
  goalMode,
}: {
  requestId: string | undefined;
  open: boolean;
  goalMode: SessionStartGoalMode | undefined;
}): SessionStartGoalDraft {
  const [draft, setDraft] = useState<{
    requestId: string | undefined;
    open: boolean;
    enabled: boolean;
    text: string | null;
  }>({ requestId, open, enabled: false, text: null });
  if (draft.requestId !== requestId || draft.open !== open) {
    setDraft({ requestId, open, enabled: false, text: null });
  }
  const unavailableReason = goalMode?.unavailableReason ?? null;
  const enabled = goalMode !== undefined && unavailableReason === null && draft.enabled;
  const text = draft.text ?? goalMode?.defaultObjective ?? "";
  const error = enabled ? goalTextError(text) : null;
  return {
    offered: goalMode !== undefined,
    unavailableReason,
    enabled,
    text,
    error,
    value: enabled && error === null ? text.trim() : undefined,
    setEnabled: (next: boolean) => setDraft((current) => ({ ...current, enabled: next })),
    setText: (next: string) => setDraft((current) => ({ ...current, text: next })),
  };
}
