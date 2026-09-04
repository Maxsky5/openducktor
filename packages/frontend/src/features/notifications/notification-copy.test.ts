import { describe, expect, test } from "bun:test";
import type { NotificationKind, NotificationOccurrence } from "@openducktor/contracts";
import { buildNotificationCopy } from "./notification-copy";

const EVENT_CASES = [
  ["agent.permission_requested", "Permission Prompt"],
  ["agent.question_asked", "Structured Question"],
  ["agent.session_error", "Agent Session Error"],
  ["agent.session_started", "Agent Session Started"],
  ["agent.session_idle", "Agent Session Idle"],
  ["workflow.spec_ready", "Spec Ready"],
  ["workflow.ready_for_dev", "Ready for Dev"],
  ["workflow.in_progress", "In Progress"],
  ["workflow.blocked", "Task Blocked"],
  ["workflow.ai_review", "AI Review"],
  ["workflow.human_review", "Human Review"],
  ["workflow.closed", "Task Closed"],
] as const satisfies readonly (readonly [NotificationKind, string])[];

const occurrence = (kind: NotificationKind): NotificationOccurrence => ({
  occurrenceId: `${kind}:/repo:task-1:event-1`,
  kind,
  repoPath: "/repo",
  repositoryLabel: "Repo",
  task: { id: "task-1", title: "Build notifications" },
  role: "build",
  status: "Needs your attention.",
  navigationTarget: {
    type: "agent_studio_task",
    repoPath: "/repo",
    taskId: "task-1",
  },
});

describe("notification copy", () => {
  test("shows the event and Task title without the Task ID", () => {
    const occurrence: NotificationOccurrence = {
      occurrenceId: "workflow.blocked:/repo:task-1:event-1",
      kind: "workflow.blocked",
      repoPath: "/repo",
      repositoryLabel: "Repo",
      task: { id: "task-1", title: "Build notifications" },
      role: "build",
      sessionLabel: "Builder session",
      status: "Task Blocked and needs attention.",
      navigationTarget: {
        type: "agent_studio_task",
        repoPath: "/repo",
        taskId: "task-1",
        preferredRole: "build",
      },
    };

    expect(buildNotificationCopy(occurrence)).toEqual({
      title: "Task Blocked: Build notifications",
      body: "Task Blocked and needs attention.\nRepo · Builder",
    });
  });

  test("removes Markdown marks from native notification text", () => {
    const occurrence: NotificationOccurrence = {
      occurrenceId: "agent.session_idle:/repo:task-1:cycle-1",
      kind: "agent.session_idle",
      repoPath: "/repo",
      repositoryLabel: "Repo",
      task: { id: "task-1", title: "Build **notifications**" },
      role: "build",
      status: "Ready with **bold**, `code`, and [a link](https://example.com).",
      navigationTarget: {
        type: "agent_studio_task",
        repoPath: "/repo",
        taskId: "task-1",
      },
    };

    expect(buildNotificationCopy(occurrence)).toEqual({
      title: "Agent Session Idle: Build notifications",
      body: "Ready with bold, code, and a link.\nRepo · Builder",
    });
  });

  for (const [kind, eventLabel] of EVENT_CASES) {
    test(`formats ${kind}`, () => {
      const copy = buildNotificationCopy(occurrence(kind));

      expect(copy).toEqual({
        title: `${eventLabel}: Build notifications`,
        body: "Needs your attention.\nRepo · Builder",
      });
      expect(copy.title).not.toContain("task-1");
      expect(copy.body).not.toContain("task-1");
    });
  }

  test("uses a session label when no Task title or role is available", () => {
    const input = occurrence("agent.session_started");
    input.task = { id: "task-1" };
    delete input.role;
    input.sessionLabel = "Background session";

    expect(buildNotificationCopy(input)).toEqual({
      title: "Agent Session Started",
      body: "Needs your attention.\nRepo · Background session",
    });
  });
});
