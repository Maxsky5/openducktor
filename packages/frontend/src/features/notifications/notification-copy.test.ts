import { describe, expect, test } from "bun:test";
import type { NotificationKind, NotificationOccurrence } from "@openducktor/contracts";
import { buildNotificationCopy } from "./notification-copy";
import { buildSessionStartErrorOccurrence } from "./session-start-occurrences";

const EVENT_CASES = [
  ["agent.permission_requested", "Builder", "Needs your attention."],
  ["agent.question_asked", "Builder", "Needs your attention."],
  ["agent.session_error", "Builder", "Needs your attention."],
  ["agent.session_started", "Builder", "Session started."],
  ["agent.session_idle", "Builder", "Needs your attention."],
  ["workflow.spec_ready", "Spec ready", "Task is ready for planning."],
  ["workflow.ready_for_dev", "Ready for dev", "The plan is ready. Start Builder to implement it."],
  ["workflow.in_progress", "In progress", "Work has started on this task."],
  ["workflow.blocked", "Blocked", "This task needs your input before work can continue."],
  ["workflow.ai_review", "Ready for QA", "The implementation is ready for QA review."],
  ["workflow.human_review", "Review", "Review the changes and approve or request updates."],
  ["workflow.closed", "Closed", "This task is closed."],
] as const satisfies readonly (readonly [NotificationKind, string, string])[];

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
  test.each([
    undefined,
    "",
    "  Connection failed.\nStart the runtime.  ",
    '{"message":"Connection failed. Start the runtime."}',
    '{"error":{"message":"Connection failed. Start the runtime."}}',
  ])("uses available start failure details in shared copy: %s", (message) => {
    const event = buildSessionStartErrorOccurrence(
      { repoPath: "/repo", repositoryLabel: "Repo" },
      {
        taskId: "task-1",
        taskTitle: "Build notifications",
        role: "build",
        workspaceId: "workspace-1",
        launchAttemptId: "launch-1",
      },
      message,
    );
    expect(buildNotificationCopy(event)).toEqual({
      title: "Builder - Build notifications",
      body: message
        ? "Connection failed. Start the runtime."
        : "The session failed. Open it for details.",
    });
  });

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
      title: "Blocked - Build notifications",
      body: "This task needs your input before work can continue.",
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
      title: "Builder - Build notifications",
      body: "Ready with bold, code, and a link.",
    });
  });

  for (const [kind, eventLabel, body] of EVENT_CASES) {
    test(`formats ${kind}`, () => {
      const copy = buildNotificationCopy(occurrence(kind));

      expect(copy).toEqual({
        title: `${eventLabel} - Build notifications`,
        body,
      });
      expect(copy.title).not.toContain("task-1");
      expect(copy.body).not.toContain("task-1");
    });
  }

  test.each([
    ["spec", "Spec"],
    ["planner", "Planner"],
    ["build", "Builder"],
    ["qa", "QA"],
  ] as const)("uses the %s role in agent titles", (role, label) => {
    expect(buildNotificationCopy({ ...occurrence("agent.session_idle"), role }).title).toBe(
      `${label} - Build notifications`,
    );
  });

  test("bounds long titles and bodies without adding repository context", () => {
    const input = occurrence("agent.session_idle");
    input.task = { id: "task-1", title: "a".repeat(300) };
    input.status = "b".repeat(600);
    const copy = buildNotificationCopy(input);
    expect(copy.title.length).toBe(180);
    expect(copy.title.startsWith("Builder - ")).toBe(true);
    expect(copy.body).toBe("b".repeat(500));
  });

  test("uses a session label when no Task title or role is available", () => {
    const input = occurrence("agent.session_started");
    input.task = { id: "task-1" };
    delete input.role;
    input.sessionLabel = "Background session";

    expect(buildNotificationCopy(input)).toEqual({
      title: "Background session",
      body: "Session started.",
    });
  });
});
