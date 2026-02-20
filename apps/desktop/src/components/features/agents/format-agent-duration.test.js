import { describe, expect, test } from "bun:test";
import { formatAgentDuration } from "./format-agent-duration";

describe("formatAgentDuration", () => {
  test("formats milliseconds for short durations", () => {
    expect(formatAgentDuration(42)).toBe("42ms");
  });

  test("formats short seconds with decimal", () => {
    expect(formatAgentDuration(4_250)).toBe("4.3s");
  });

  test("formats minutes and seconds", () => {
    expect(formatAgentDuration(95_000)).toBe("1m35s");
  });

  test("formats hours with minutes and seconds", () => {
    expect(formatAgentDuration(3_661_000)).toBe("1h1m1s");
  });
});
