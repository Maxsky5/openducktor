import { describe, expect, test } from "bun:test";
import {
  AGENT_NOTIFICATION_KIND_VALUES,
  NOTIFICATION_CUE_VALUES,
  createDefaultNotificationSettings,
  notificationOccurrenceSchema,
  notificationNavigationTargetSchema,
  notificationOsDeliveryRequestSchema,
  notificationSettingsSchema,
} from "./notification-schemas";

describe("notification contracts", () => {
  test.each(["permission", "question"] as const)(
    "retains long %s request identities",
    (inputKind) => {
      const target = {
        type: "pending_input",
        repoPath: "/repo",
        taskId: "task",
        session: { externalSessionId: "session", runtimeKind: "codex", workingDirectory: "/repo" },
        inputKind,
        requestId: "request-".repeat(300),
      };
      expect(notificationNavigationTargetSchema.parse(target)).toEqual(target);
      expect(
        notificationNavigationTargetSchema.safeParse({ ...target, requestId: " " }).success,
      ).toBe(false);
    },
  );

  test("ships the agent catalogue and defaults", () => {
    const settings = createDefaultNotificationSettings();

    expect(AGENT_NOTIFICATION_KIND_VALUES).toEqual([
      "agent.permission_requested",
      "agent.question_asked",
      "agent.session_error",
      "agent.session_started",
      "agent.session_idle",
    ]);
    expect(Object.keys(settings.kinds)).toEqual([...AGENT_NOTIFICATION_KIND_VALUES]);
    expect(settings).toMatchObject({
      globalCue: "chime",
      volumePercent: 30,
      osFocus: "suppress_if_focused",
      soundFocus: "mute_while_focused",
    });
    expect(settings.kinds).toEqual({
      "agent.permission_requested": { enabled: true, target: "both", sound: "bloom" },
      "agent.question_asked": { enabled: true, target: "both", sound: "bloom" },
      "agent.session_error": { enabled: true, target: "both", sound: "inherit" },
      "agent.session_started": { enabled: true, target: "in_app", sound: "inherit" },
      "agent.session_idle": { enabled: false, target: "both", sound: "inherit" },
    });
  });

  test("adds the workflow kinds that the caller supplies", () => {
    const blocked = { enabled: true, target: "both", sound: "bloom" } as const;
    const settings = createDefaultNotificationSettings({ "workflow.blocked": blocked });

    expect(settings.kinds["workflow.blocked"]).toEqual(blocked);
    expect(notificationSettingsSchema.parse(settings)).toEqual(settings);
  });

  test("requires every agent kind and rejects kinds outside both catalogues", () => {
    const settings = createDefaultNotificationSettings();
    const { "agent.session_idle": _removed, ...kinds } = settings.kinds;
    const setting = { enabled: true, target: "both", sound: "inherit" };

    expect(notificationSettingsSchema.safeParse({ ...settings, kinds }).success).toBe(false);
    expect(
      notificationSettingsSchema.safeParse({
        ...settings,
        kinds: { ...settings.kinds, "release.draft": setting },
      }).success,
    ).toBe(false);
  });

  test("exposes all 17 Cuelume cues", () => {
    expect(NOTIFICATION_CUE_VALUES).toEqual([
      "chime",
      "sparkle",
      "droplet",
      "bloom",
      "whisper",
      "tick",
      "press",
      "release",
      "toggle",
      "success",
      "error",
      "page",
      "loading",
      "ready",
      "pulse",
      "scan",
      "arrival",
    ]);
  });

  test("defaults a missing notification settings object without sharing nested state", () => {
    const first = notificationSettingsSchema.parse(undefined);
    const second = notificationSettingsSchema.parse(undefined);

    first.kinds["agent.session_idle"].enabled = true;
    expect(second).toEqual(createDefaultNotificationSettings());
  });

  test("rejects unsafe occurrence fields and runtime routes", () => {
    const occurrence = {
      occurrenceId: "agent.session_started:/repo:session-1",
      kind: "agent.session_started",
      repoPath: "/repo",
      repositoryLabel: "Repo",
      task: { id: "task-1", title: "Build notifications" },
      role: "build",
      sessionLabel: "Builder session",
      status: "Agent Session started.",
      navigationTarget: {
        type: "agent_session",
        repoPath: "/repo",
        taskId: "task-1",
        session: {
          externalSessionId: "session-1",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree",
        },
      },
    } as const;

    expect(notificationOccurrenceSchema.parse(occurrence)).toEqual(occurrence);
    expect(() =>
      notificationOccurrenceSchema.parse({ ...occurrence, rawPrompt: "secret" }),
    ).toThrow();
    expect(() =>
      notificationOccurrenceSchema.parse({
        ...occurrence,
        navigationTarget: {
          ...occurrence.navigationTarget,
          runtimeEndpoint: "http://127.0.0.1:3000",
        },
      }),
    ).toThrow();
  });

  test("requires OS delivery to be silent", () => {
    const request = {
      occurrenceId: "workflow.closed:/repo:task-1:event-1",
      title: "Task Closed - task-1",
      body: "Repo - Build notifications",
      silent: true,
      navigationTarget: {
        type: "kanban_task",
        repoPath: "/repo",
        taskId: "task-1",
      },
    } as const;

    expect(notificationOsDeliveryRequestSchema.parse(request)).toEqual(request);
    for (const purpose of ["notification", "test"] as const) {
      expect(notificationOsDeliveryRequestSchema.parse({ ...request, purpose })).toEqual({
        ...request,
        purpose,
      });
    }
    expect(() =>
      notificationOsDeliveryRequestSchema.parse({ ...request, purpose: "background_test" }),
    ).toThrow();
    expect(() =>
      notificationOsDeliveryRequestSchema.parse({ ...request, silent: false }),
    ).toThrow();
  });

  test("allows exact repository session routes without a task", () => {
    const target = {
      type: "agent_session",
      repoPath: "/repo",
      session: {
        externalSessionId: "session-1",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      },
    } as const;

    expect(notificationNavigationTargetSchema.parse(target)).toEqual(target);
  });
});
