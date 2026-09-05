import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_CUE_VALUES,
  NOTIFICATION_KIND_VALUES,
  notificationOccurrenceSchema,
  notificationNavigationTargetSchema,
  notificationOsDeliveryRequestSchema,
  notificationSettingsSchema,
} from "./notification-schemas";

const expectedKinds = [
  "agent.permission_requested",
  "agent.question_asked",
  "agent.session_error",
  "agent.session_started",
  "agent.session_idle",
  "workflow.spec_ready",
  "workflow.ready_for_dev",
  "workflow.in_progress",
  "workflow.blocked",
  "workflow.ai_review",
  "workflow.human_review",
  "workflow.closed",
] as const;

describe("notification contracts", () => {
  test("ships the exact v1 catalogue and defaults", () => {
    const bloomKinds = new Set([
      "agent.permission_requested",
      "agent.question_asked",
      "workflow.blocked",
    ]);
    const inAppKinds = new Set(["agent.session_started", "workflow.closed"]);

    expect(NOTIFICATION_KIND_VALUES).toEqual(expectedKinds);
    expect(Object.keys(DEFAULT_NOTIFICATION_SETTINGS.kinds)).toEqual(expectedKinds);
    expect(DEFAULT_NOTIFICATION_SETTINGS.globalCue).toBe("chime");
    expect(DEFAULT_NOTIFICATION_SETTINGS.volumePercent).toBe(30);
    expect(DEFAULT_NOTIFICATION_SETTINGS.osFocus).toBe("suppress_if_focused");
    expect(DEFAULT_NOTIFICATION_SETTINGS.soundFocus).toBe("mute_while_focused");

    for (const kind of expectedKinds) {
      const setting = DEFAULT_NOTIFICATION_SETTINGS.kinds[kind];
      expect(setting.sound).toBe(bloomKinds.has(kind) ? "bloom" : "inherit");
      expect(setting.target).toBe(inAppKinds.has(kind) ? "in_app" : "both");
      expect(setting.enabled).toBe(kind !== "agent.session_idle");
    }
    expect(new Set<string>(NOTIFICATION_KIND_VALUES).has("workflow.open")).toBe(false);
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
    expect(second).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
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
