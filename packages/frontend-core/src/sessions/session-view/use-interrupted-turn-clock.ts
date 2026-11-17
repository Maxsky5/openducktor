import type { AgentSessionUsageLimit, UsageLimitAutoResume } from "@openducktor/contracts";
import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/** The time that the notice counts down to: the planned resume, else the reported reset. */
const countdownTarget = (
  usageLimit: AgentSessionUsageLimit | undefined,
  autoResume: UsageLimitAutoResume | undefined,
): number | undefined =>
  autoResume?.state === "scheduled" ? autoResume.resumeAtEpochMs : usageLimit?.resetsAtEpochMs;

/**
 * The current time for the resume notice. It changes when the whole minutes left before the
 * countdown target change, so the countdown never shows a minute that already passed.
 */
export const useInterruptedTurnClock = (
  usageLimit: AgentSessionUsageLimit | undefined,
  autoResume: UsageLimitAutoResume | undefined,
): number => {
  const [now, setNow] = useState(Date.now);
  const target = countdownTarget(usageLimit, autoResume);
  useEffect(() => {
    if (target === undefined) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const left = target - current;
      if (left > 0) timer = setTimeout(tick, left % MINUTE_MS || MINUTE_MS);
    };
    // A new target reads the time at once, because the last value can be older than a minute.
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [target]);
  return now;
};
