import type { AgentSessionTranscriptEvent, AgentTurnOutcome } from "@openducktor/contracts";
import { z } from "zod";

const toolProgressMetadataSchema = z.union([
  z.object({ backgroundTaskId: z.string().min(1) }),
  z.object({ elapsedTimeSeconds: z.number() }),
]);

/**
 * Assistant output that proves a turn ran new model work. Background subagent updates,
 * background tool updates (`backgroundTaskId`), and `tool_progress` heartbeats
 * (`elapsedTimeSeconds`) can arrive after a failed turn without starting a new reply.
 */
export const isNewTurnWorkEvent = (event: AgentSessionTranscriptEvent): boolean => {
  switch (event.type) {
    case "assistant_delta":
    case "assistant_message":
      return true;
    case "assistant_part":
      switch (event.part.kind) {
        case "image_generation":
        case "text":
        case "reasoning":
        case "step":
          return true;
        case "tool": {
          if (event.part.status !== "pending" && event.part.status !== "running") return false;
          const { metadata } = event.part;
          if (
            !metadata ||
            (!("backgroundTaskId" in metadata) && !("elapsedTimeSeconds" in metadata))
          ) {
            return true;
          }
          return !toolProgressMetadataSchema.safeParse(metadata).success;
        }
        case "subagent":
          return false;
      }
    default:
      return false;
  }
};

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
