import type { AgentSessionUsageLimit } from "@openducktor/contracts";

/** The words of the interrupted-turn resume notice that both clients show. */
export const INTERRUPTED_TURN_COPY = {
  stoppedTitle: "This turn stopped before it finished.",
  stoppedDetail: "Resume continues from where it stopped, without a new message.",
  usageLimitTitle: "The session reached its usage limit.",
  usageLimitWithoutReset:
    "Resume when usage is available. The runtime did not report a reset time.",
  usageLimitResetPassed: "The reported reset time has passed. Select Resume to try again.",
  resumeAfterReset: "Resume after the reset.",
  resume: "Resume",
  resuming: "Resuming",
} as const;

/** The time left until a reported usage limit reset. */
export type UsageLimitCountdown =
  | { kind: "passed" }
  | { kind: "pending"; remaining: string; resetsAt: Date };

export const usageLimitCountdown = (resetsAtEpochMs: number, now: number): UsageLimitCountdown => {
  const minutes = Math.max(0, Math.ceil((resetsAtEpochMs - now) / 60_000));
  if (minutes === 0) return { kind: "passed" };
  const hours = Math.floor(minutes / 60);
  return {
    kind: "pending",
    remaining: hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`,
    resetsAt: new Date(resetsAtEpochMs),
  };
};

/** The title of the resume notice for the latest turn. */
export const interruptedTurnTitle = (usageLimit: AgentSessionUsageLimit | undefined): string =>
  usageLimit ? INTERRUPTED_TURN_COPY.usageLimitTitle : INTERRUPTED_TURN_COPY.stoppedTitle;

/** The reset line of a pending usage limit, with the reset time as the client formats it. */
export const usageLimitResetText = (remaining: string, resetsAtLabel: string): string =>
  `Resets in ${remaining} at ${resetsAtLabel}. ${INTERRUPTED_TURN_COPY.resumeAfterReset}`;
