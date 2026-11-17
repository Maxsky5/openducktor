import type { AgentTurnOutcome } from "@openducktor/contracts";

/** The part of a usage-limit stop that decides what a later live signal means. */
export type UsageLimitStopProgress = {
  /** The native message ID of the error. Claude sends the error again with its reset time. */
  readonly stopId: string | undefined;
  /** The failed turn of the stop ended, so a later turn end belongs to a new turn. */
  readonly turnEnded: boolean;
};

/** A live signal after a usage-limit stop. */
export type UsageLimitStopSignal =
  | { readonly kind: "limit_error"; readonly stopId: string | undefined }
  | { readonly kind: "turn_end"; readonly outcome: AgentTurnOutcome }
  | { readonly kind: "other" };

/**
 * What a live signal means for a usage-limit stop. The message queue pause and the auto-resume
 * both follow these rules, so they agree about which turn failed.
 * - `same_stop`: the error of the stop repeats.
 * - `turn_ended`: the failed turn of the stop ended.
 * - `replaced`: a new stop, a later turn end, or another signal follows the stop.
 */
export const nextUsageLimitStop = (
  current: UsageLimitStopProgress,
  signal: UsageLimitStopSignal,
): "same_stop" | "turn_ended" | "replaced" => {
  switch (signal.kind) {
    case "limit_error":
      return signal.stopId === current.stopId ? "same_stop" : "replaced";
    case "turn_end":
      return !current.turnEnded && signal.outcome !== "completed" ? "turn_ended" : "replaced";
    case "other":
      return "replaced";
  }
};
