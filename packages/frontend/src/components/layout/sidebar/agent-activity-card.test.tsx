import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AgentActivityCard } from "./agent-activity-card";

const activeSession = {
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
  taskId: "task-1",
  taskTitle: "Add SSO",
  role: "build" as const,
  activityState: "starting" as const,
  startedAt: "2026-02-26T10:00:00.000Z",
};

const waitingSession = {
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-2",
  taskId: "task-2",
  taskTitle: "Validate QA flow",
  role: "qa" as const,
  activityState: "waiting_input" as const,
  startedAt: "2026-02-26T09:00:00.000Z",
};

const expectedSessionHref = (session: typeof activeSession | typeof waitingSession): string => {
  const params = new URLSearchParams({
    task: session.taskId,
    session: session.externalSessionId,
    agent: session.role,
  });
  return `/agents?${params.toString()}`.replaceAll("&", "&amp;");
};

describe("AgentActivityCard", () => {
  test("renders active/waiting counters and session deep links", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(AgentActivityCard, {
          activeSessionCount: 1,
          waitingForInputCount: 1,
          activeSessions: [activeSession],
          waitingForInputSessions: [waitingSession],
        }),
      ),
    );

    expect(html).toContain("Agent Activity");
    expect(html).toContain("Active sessions");
    expect(html).toContain("Needs your input");
    expect(html).toContain(">1<");
    expect(html).toContain("Add SSO");
    expect(html).toContain("Validate QA flow");
    expect(html).toContain("BUILD · starting");
    expect(html).toContain("QA · waiting input");
    expect(html).toContain(`href="${expectedSessionHref(activeSession)}"`);
    expect(html).toContain(`href="${expectedSessionHref(waitingSession)}"`);
  });

  test("does not render redundant empty waiting text when there are no waiting sessions", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(AgentActivityCard, {
          activeSessionCount: 0,
          waitingForInputCount: 0,
          activeSessions: [],
          waitingForInputSessions: [],
        }),
      ),
    );

    expect(html).not.toContain("No sessions are waiting on user input.");
    expect(html).not.toContain("Open Agents");
  });
});
