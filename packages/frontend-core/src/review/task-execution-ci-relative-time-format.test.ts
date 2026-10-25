import { describe, expect, test } from "bun:test";
import { formatCiRelativeTime } from "./task-execution-ci-relative-time-format";

describe("formatCiRelativeTime", () => {
  const now = Date.parse("2026-07-09T12:00:00Z");

  test("formats recent activity with compact elapsed time", () => {
    expect(formatCiRelativeTime("2026-07-09T11:59:42Z", now)).toBe("now");
    expect(formatCiRelativeTime("2026-07-09T11:42:00Z", now)).toBe("18m ago");
    expect(formatCiRelativeTime("2026-07-09T09:00:00Z", now)).toBe("3h ago");
    expect(formatCiRelativeTime("2026-07-07T12:00:00Z", now)).toBe("2d ago");
  });

  test("returns the original value when the timestamp is invalid", () => {
    expect(formatCiRelativeTime("not-a-date", now)).toBe("not-a-date");
  });
});
