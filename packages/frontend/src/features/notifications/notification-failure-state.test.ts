import { describe, expect, test } from "bun:test";
import type { NotificationDispatchFailure } from "./notification-policy";
import { selectOsFailureState } from "./notification-failure-state";

const failure = (
  occurrenceId: string,
  message = "OS notification permission is denied.",
): NotificationDispatchFailure => ({
  channel: "os",
  kind: "agent.session_idle",
  occurrenceId,
  repoPath: "/repo",
  message,
});

describe("OS notification failure state", () => {
  test("keeps one state for repeated failures with the same cause", () => {
    const current = failure("occurrence-1");

    expect(selectOsFailureState(current, failure("occurrence-2"))).toBe(current);
  });

  test("starts a new state when the failure cause changes", () => {
    const next = failure("occurrence-2", "The OS notification service failed.");

    expect(selectOsFailureState(failure("occurrence-1"), next)).toBe(next);
  });

  test("starts a new state after a successful delivery clears the failure", () => {
    const next = failure("occurrence-2");

    expect(selectOsFailureState(null, next)).toBe(next);
  });
});
