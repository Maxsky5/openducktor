import { goalObjectiveLengthProblem } from "@openducktor/core";
import { useState } from "react";
import { errorMessage } from "../../lib/errors";
import type { SessionStartGoalMode, SessionStartModalModel } from "./session-start-modal-model";
import {
  type SessionStartKickoffDraft,
  useSessionStartKickoffDraft,
} from "./use-session-start-kickoff-draft";

export const BLANK_GOAL_ERROR = "Enter a goal.";
export const GOAL_GENERATION_RUNNING = "Wait for the generated goal.";

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
  /** Why the start must wait: the goal text error, or a goal generation that runs. */
  blockedReason: string | null;
  /** The goal objective that the start sets, or undefined with Goal mode off. */
  value: string | undefined;
  /** An agent writes the goal text. The result replaces the text. */
  generation: {
    /** Why no agent can write the goal, or null. */
    unavailableReason: string | null;
    running: boolean;
    error: string | null;
    start: () => void;
  };
  setEnabled: (enabled: boolean) => void;
  setText: (text: string) => void;
};

type Draft = {
  requestId: string | undefined;
  open: boolean;
  enabled: boolean;
  text: string | null;
  /** The running generation. A reset or a newer generation drops its result. */
  generationId: symbol | null;
  generationError: string | null;
};

const goalTextError = (text: string): string | null => {
  const objective = text.trim();
  return objective ? goalObjectiveLengthProblem(objective) : BLANK_GOAL_ERROR;
};

const initialDraft = (requestId: string | undefined, open: boolean): Draft => ({
  requestId,
  open,
  enabled: false,
  text: null,
  generationId: null,
  generationError: null,
});

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
  const [draft, setDraft] = useState<Draft>(() => initialDraft(requestId, open));
  if (draft.requestId !== requestId || draft.open !== open) {
    setDraft(initialDraft(requestId, open));
  }
  const unavailableReason = goalMode?.unavailableReason ?? null;
  const enabled = goalMode !== undefined && unavailableReason === null && draft.enabled;
  const text = draft.text ?? goalMode?.defaultObjective ?? "";
  const error = enabled ? goalTextError(text) : null;
  const generation = goalMode?.generation;
  const settle = (generationId: symbol, update: Partial<Draft>) =>
    setDraft((current) =>
      current.generationId === generationId
        ? { ...current, ...update, generationId: null }
        : current,
    );
  return {
    offered: goalMode !== undefined,
    unavailableReason,
    enabled,
    text,
    error,
    blockedReason: draft.generationId === null ? error : GOAL_GENERATION_RUNNING,
    value: enabled && error === null ? text.trim() : undefined,
    generation: {
      unavailableReason: generation?.kind === "unavailable" ? generation.reason : null,
      running: draft.generationId !== null,
      error: draft.generationError,
      start: () => {
        if (generation?.kind !== "available") return;
        const generationId = Symbol("goal generation");
        setDraft((current) => ({ ...current, generationId, generationError: null }));
        generation.run().then(
          (generated) => settle(generationId, { text: generated }),
          (cause: unknown) => settle(generationId, { generationError: errorMessage(cause) }),
        );
      },
    },
    setEnabled: (next: boolean) => setDraft((current) => ({ ...current, enabled: next })),
    setText: (next: string) => setDraft((current) => ({ ...current, text: next })),
  };
}

export type SessionStartInstructionDrafts = {
  goal: SessionStartGoalDraft;
  kickoff: SessionStartKickoffDraft;
};

/** The goal and the first message of a start form. Goal mode sends the goal instead of the message. */
export function useSessionStartInstructionDrafts(
  model: Pick<SessionStartModalModel, "requestId" | "open" | "goalMode" | "kickoffPrompt">,
): SessionStartInstructionDrafts {
  const goal = useSessionStartGoalDraft({
    requestId: model.requestId,
    open: model.open,
    goalMode: model.goalMode,
  });
  const kickoff = useSessionStartKickoffDraft({
    requestId: model.requestId,
    open: model.open,
    prompt: goal.enabled ? undefined : model.kickoffPrompt,
  });
  return { goal, kickoff };
}
