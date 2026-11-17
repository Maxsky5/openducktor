import type { AgentSessionUsageLimit, UsageLimitAutoResume } from "@openducktor/contracts";
import {
  INTERRUPTED_TURN_COPY,
  interruptedTurnTitle,
  usageLimitCountdown,
} from "./interrupted-turn-copy";

/** A piece of the detail line. Clients render a time and a countdown in their own way. */
export type InterruptedTurnDetailPart =
  | { kind: "text"; text: string }
  | { kind: "time"; time: Date }
  | { kind: "timer"; text: string };

/** The detail line of the notice, so both clients show the same words. */
export type InterruptedTurnDetail = InterruptedTurnDetailPart[];

const textDetail = (text: string): InterruptedTurnDetail => [{ kind: "text", text }];

/** What both clients show for an interrupted turn that offers Resume. */
export type InterruptedTurnNotice = {
  title: string;
  detail: InterruptedTurnDetail;
  isResuming: boolean;
  canCancelAutoResume: boolean;
  error: string | null;
};

type InterruptedTurnNoticeInput = {
  /** The usage limit of the latest turn, or undefined when it stopped for another reason. */
  usageLimit: AgentSessionUsageLimit | undefined;
  /** The host-planned resume of the session. */
  autoResume: UsageLimitAutoResume | undefined;
  /** A Resume of this client runs. */
  isResuming: boolean;
  /** The failure of the latest Resume of this client. */
  resumeError: string | null;
  now: number;
};

const resetDetail = (usageLimit: AgentSessionUsageLimit, now: number): InterruptedTurnDetail => {
  if (usageLimit.resetsAtEpochMs === undefined)
    return textDetail(INTERRUPTED_TURN_COPY.usageLimitWithoutReset);
  const countdown = usageLimitCountdown(usageLimit.resetsAtEpochMs, now);
  if (countdown.kind === "passed") return textDetail(INTERRUPTED_TURN_COPY.usageLimitResetPassed);
  return [
    { kind: "timer", text: `Resets in ${countdown.remaining}` },
    { kind: "text", text: " at " },
    { kind: "time", time: countdown.resetsAt },
    { kind: "text", text: `. ${INTERRUPTED_TURN_COPY.resumeAfterReset}` },
  ];
};

const autoResumeDetail = (resumeAtEpochMs: number, now: number): InterruptedTurnDetail => {
  const countdown = usageLimitCountdown(resumeAtEpochMs, now);
  const start: InterruptedTurnDetail = [
    { kind: "text", text: "Resumes automatically at " },
    { kind: "time", time: new Date(resumeAtEpochMs) },
  ];
  if (countdown.kind === "passed") return [...start, { kind: "text", text: "." }];
  return [
    ...start,
    { kind: "text", text: " (" },
    { kind: "timer", text: `in ${countdown.remaining}` },
    { kind: "text", text: ")." },
  ];
};

/** The planned auto-resume of the host replaces the reset countdown. */
const usageLimitDetail = (
  usageLimit: AgentSessionUsageLimit,
  autoResume: UsageLimitAutoResume | undefined,
  now: number,
): InterruptedTurnDetail => {
  switch (autoResume?.state) {
    case "resuming":
      return textDetail(INTERRUPTED_TURN_COPY.autoResuming);
    case "scheduled":
      return autoResumeDetail(autoResume.resumeAtEpochMs, now);
    default:
      return resetDetail(usageLimit, now);
  }
};

/**
 * Builds the resume notice of the latest turn. The host-planned resume applies only to a
 * usage-limit stop. A Resume failure of this client is newer than a failed auto-resume.
 */
export const buildInterruptedTurnNotice = ({
  usageLimit,
  autoResume,
  isResuming,
  resumeError,
  now,
}: InterruptedTurnNoticeInput): InterruptedTurnNotice => {
  const title = interruptedTurnTitle(usageLimit);
  if (!usageLimit)
    return {
      title,
      detail: textDetail(INTERRUPTED_TURN_COPY.stoppedDetail),
      isResuming,
      canCancelAutoResume: false,
      error: resumeError,
    };
  const resuming = isResuming || autoResume?.state === "resuming";
  const failure =
    autoResume?.state === "failed"
      ? `${autoResume.failure.message} ${autoResume.failure.nextAction}`
      : null;
  return {
    title,
    detail: usageLimitDetail(usageLimit, autoResume, now),
    isResuming: resuming,
    canCancelAutoResume: autoResume?.state === "scheduled" && !resuming,
    error: resumeError ?? failure,
  };
};

/** The text of a detail line, with the times as the client formats them. */
export const interruptedTurnDetailText = (
  detail: InterruptedTurnDetail,
  formatTime: (time: Date) => string,
): string =>
  detail.map((part) => (part.kind === "time" ? formatTime(part.time) : part.text)).join("");
