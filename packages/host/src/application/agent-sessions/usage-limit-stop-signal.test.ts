import { describe, expect, test } from "bun:test";
import { nextUsageLimitStop } from "./usage-limit-stop-signal";

const open = { stopId: "limit-1", turnEnded: false };
const ended = { stopId: "limit-1", turnEnded: true };

describe("nextUsageLimitStop", () => {
  test.each([
    {
      name: "the same error",
      current: ended,
      signal: { kind: "limit_error", stopId: "limit-1" },
      result: "same_stop",
    },
    {
      name: "a new error",
      current: open,
      signal: { kind: "limit_error", stopId: "limit-2" },
      result: "replaced",
    },
    {
      name: "the failed turn end",
      current: open,
      signal: { kind: "turn_end", outcome: "failed" },
      result: "turn_ended",
    },
    {
      name: "the interrupted turn end",
      current: open,
      signal: { kind: "turn_end", outcome: "interrupted" },
      result: "turn_ended",
    },
    {
      name: "a completed turn",
      current: open,
      signal: { kind: "turn_end", outcome: "completed" },
      result: "replaced",
    },
    {
      name: "a later turn end",
      current: ended,
      signal: { kind: "turn_end", outcome: "failed" },
      result: "replaced",
    },
    { name: "another signal", current: open, signal: { kind: "other" }, result: "replaced" },
  ] as const)("$name gives $result", ({ current, signal, result }) => {
    expect(nextUsageLimitStop(current, signal)).toBe(result);
  });
});
