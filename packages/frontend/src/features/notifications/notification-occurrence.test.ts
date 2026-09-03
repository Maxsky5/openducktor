import { describe, expect, test } from "bun:test";
import type { NotificationOccurrence } from "@openducktor/contracts";
import { prepareNotificationOccurrence } from "./notification-occurrence";

const occurrence = (overrides: Partial<NotificationOccurrence> = {}): NotificationOccurrence => ({
  occurrenceId: "occurrence-1",
  kind: "agent.session_idle",
  repoPath: "/repo",
  repositoryLabel: "Repo",
  task: { id: "task-1", title: "Task" },
  sessionLabel: "Agent Session",
  status: "Agent Session is idle.",
  navigationTarget: {
    type: "agent_session",
    repoPath: "/repo",
    session: {
      externalSessionId: "session-1",
    },
  },
  ...overrides,
});

describe("notification occurrence display text", () => {
  test("bounds display labels before contract validation", () => {
    const prepared = prepareNotificationOccurrence(
      occurrence({
        repositoryLabel: `  ${"r".repeat(140)}  `,
        task: { id: "task-1", title: `  ${"t".repeat(260)}  ` },
        sessionLabel: `  ${"s".repeat(140)}  `,
      }),
    );

    expect(prepared.repositoryLabel).toHaveLength(120);
    expect(prepared.task?.title).toHaveLength(240);
    expect(prepared.sessionLabel).toHaveLength(120);
  });

  test("omits an empty optional display label", () => {
    const prepared = prepareNotificationOccurrence(
      occurrence({ task: { id: "task-1", title: "   " }, sessionLabel: "   " }),
    );

    expect(prepared.task).toEqual({ id: "task-1" });
    expect(prepared.sessionLabel).toBeUndefined();
  });
});
