import { describe, expect, test } from "bun:test";
import {
  interruptedTurnTitle,
  usageLimitCountdown,
  usageLimitResetText,
} from "./interrupted-turn-copy";

describe("usageLimitCountdown", () => {
  const now = Date.UTC(2026, 9, 19, 10, 0, 0);

  test("reports a passed reset when no whole minute remains", () => {
    expect(usageLimitCountdown(now, now)).toEqual({ kind: "passed" });
    expect(usageLimitCountdown(now - 60_000, now)).toEqual({ kind: "passed" });
  });

  test("rounds the remaining time up to the next minute", () => {
    expect(usageLimitCountdown(now + 1_000, now)).toMatchObject({
      kind: "pending",
      remaining: "1m",
    });
  });

  test("shows hours and minutes for a reset more than one hour away", () => {
    const countdown = usageLimitCountdown(now + (2 * 60 + 5) * 60_000, now);
    expect(countdown).toMatchObject({ kind: "pending", remaining: "2h 5m" });
  });
});

test("interruptedTurnTitle names a usage limit stop", () => {
  expect(interruptedTurnTitle({ resetsAtEpochMs: 1 })).toBe("The session reached its usage limit.");
  expect(interruptedTurnTitle(undefined)).toBe("This turn stopped before it finished.");
});

test("usageLimitResetText tells the user when to resume", () => {
  expect(usageLimitResetText("5m", "10:05")).toBe("Resets in 5m at 10:05. Resume after the reset.");
});
