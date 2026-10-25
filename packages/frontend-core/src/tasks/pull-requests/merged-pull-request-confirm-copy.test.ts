import { describe, expect, test } from "bun:test";
import { formatMergedAt } from "./merged-pull-request-confirm-copy";

describe("formatMergedAt", () => {
  test("formats a merge time as a local date and time", () => {
    const value = "2026-09-02T10:00:00Z";
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
    expect(formatMergedAt(value)).toBe(expected);
  });

  test("keeps a value that is not a date", () => {
    expect(formatMergedAt("unknown")).toBe("unknown");
  });
});
