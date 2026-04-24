import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AgentActivityCard } from "./agent-activity-card";

const activeSession = {
  runtimeKind: "opencode",
  sessionId: "session-1",
  taskId: "task-1",
  taskTitle: "Add SSO",
  role: "build" as const,
  scenario: "build_implementation_start" as const,
  status: "running" as const,
  startedAt: "2026-02-26T10:00:00.000Z",
};

const waitingSession = {
  runtimeKind: "opencode",
  sessionId: "session-2",
  taskId: "task-2",
  taskTitle: "Validate QA flow",
  role: "qa" as const,
  scenario: "qa_review" as const,
  status: "idle" as const,
  startedAt: "2026-02-26T09:00:00.000Z",
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
    expect(html).toContain(
      'href="/agents?task=task-1&amp;session=session-1&amp;agent=build&amp;scenario=build_implementation_start"',
    );
    expect(html).toContain(
      'href="/agents?task=task-2&amp;session=session-2&amp;agent=qa&amp;scenario=qa_review"',
    );
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
