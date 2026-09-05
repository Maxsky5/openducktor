import { describe, expect, test } from "bun:test";
import type { NotificationDispatchFailure } from "./notification-policy";
import {
  clearCoordinationNotificationFailure,
  clearOsNotificationFailure,
  createNotificationFailureState,
  recordNotificationFailure,
  selectNotificationFailure,
} from "./notification-failure-state";

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

describe("notification failure state", () => {
  test("keeps one state for repeated failures with the same cause", () => {
    const current = failure("occurrence-1");
    const state = recordNotificationFailure(createNotificationFailureState(), current);

    expect(
      selectNotificationFailure(recordNotificationFailure(state, failure("occurrence-2"))),
    ).toBe(current);
  });

  test("keeps the active state when the failure cause changes", () => {
    const current = failure("occurrence-1");
    const next = failure("occurrence-2", "The OS notification service failed.");
    const state = recordNotificationFailure(createNotificationFailureState(), current);

    expect(selectNotificationFailure(recordNotificationFailure(state, next))).toBe(current);
  });

  test("starts a new state after a successful delivery clears the failure", () => {
    const next = failure("occurrence-2");
    const cleared = clearOsNotificationFailure(
      recordNotificationFailure(createNotificationFailureState(), failure("occurrence-1")),
    );

    expect(selectNotificationFailure(recordNotificationFailure(cleared, next))).toBe(next);
  });

  test("keeps a coordination failure when OS delivery succeeds", () => {
    const coordinationFailure = {
      ...failure("coordination-failure"),
      channel: "coordination" as const,
    };
    const state = recordNotificationFailure(createNotificationFailureState(), coordinationFailure);

    expect(selectNotificationFailure(clearOsNotificationFailure(state))).toBe(coordinationFailure);
  });

  test("shows a later OS failure after coordination recovers", () => {
    const coordinationFailure = {
      ...failure("coordination-failure"),
      channel: "coordination" as const,
    };
    const withCoordinationFailure = recordNotificationFailure(
      createNotificationFailureState(),
      coordinationFailure,
    );
    const recovered = clearCoordinationNotificationFailure(withCoordinationFailure);
    const osFailure = failure("os-failure");

    expect(selectNotificationFailure(recordNotificationFailure(recovered, osFailure))).toBe(
      osFailure,
    );
  });
});

test("keeps settings failures visible until settings recover", async () => {
  const { clearSettingsNotificationFailure } = await import("./notification-failure-state");
  const settings = { ...failure("settings-failed"), channel: "settings" as const };
  const os = failure("os-failed");
  const state = recordNotificationFailure(
    recordNotificationFailure(createNotificationFailureState(), os),
    settings,
  );
  expect(selectNotificationFailure(clearOsNotificationFailure(state))).toBe(settings);
  expect(selectNotificationFailure(clearCoordinationNotificationFailure(state))).toBe(settings);
  expect(selectNotificationFailure(clearSettingsNotificationFailure(state))).toBe(os);
});
