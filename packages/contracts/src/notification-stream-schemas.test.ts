import { expect, test } from "bun:test";
import {
  notificationActionOccurrenceSchema,
  selectedNotificationSchema,
} from "./notification-stream-schemas";
import { createDefaultNotificationSettings } from "./notification-schemas";
const occurrence = {
  occurrenceId: "start",
  kind: "agent.session_started",
  repoPath: "/repo",
  repositoryLabel: "Repo",
  status: "Started",
  navigationTarget: {
    type: "agent_session",
    repoPath: "/repo",
    session: { externalSessionId: "native", runtimeKind: "codex", workingDirectory: "/repo" },
  },
};
test("selected transport requires a complete preference snapshot with no config defaults", () => {
  expect(selectedNotificationSchema.safeParse({ occurrence, preferenceRevision: 1 }).success).toBe(
    false,
  );
  expect(
    selectedNotificationSchema.safeParse({ occurrence, settings: {}, preferenceRevision: 1 })
      .success,
  ).toBe(false);
  const settings = createDefaultNotificationSettings();
  expect(
    selectedNotificationSchema.parse({ occurrence, settings, preferenceRevision: 1 }).settings,
  ).toEqual(settings);
  // Every kind must be present; transport cannot activate substitute defaults.
  const { "workflow.closed": _removed, ...kinds } = settings.kinds;
  expect(
    selectedNotificationSchema.safeParse({
      occurrence,
      settings: { ...settings, kinds },
      preferenceRevision: 1,
    }).success,
  ).toBe(false);
});
test("action publication cannot supply preferences or fabricate workflow and pending-input alerts", () => {
  expect(notificationActionOccurrenceSchema.safeParse(occurrence).success).toBe(true);
  expect(
    notificationActionOccurrenceSchema.safeParse({ ...occurrence, kind: "workflow.closed" })
      .success,
  ).toBe(false);
  expect(
    notificationActionOccurrenceSchema.safeParse({ ...occurrence, kind: "agent.question_asked" })
      .success,
  ).toBe(false);
  expect(
    notificationActionOccurrenceSchema.safeParse({
      ...occurrence,
      settings: createDefaultNotificationSettings(),
    }).success,
  ).toBe(false);
});
