import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AgentActivityCard } from "./agent-activity-card";

describe("AgentActivityCard", () => {
  test("renders active/waiting counters and call to action when waiting exists", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(AgentActivityCard, {
          activeSessionCount: 3,
          waitingForInputCount: 2,
        }),
      ),
    );

    expect(html).toContain("Agent Activity");
    expect(html).toContain("Active sessions");
    expect(html).toContain("Needs your input");
    expect(html).toContain(">3<");
    expect(html).toContain(">2<");
    expect(html).toContain("Open Agents");
  });

  test("renders empty waiting state copy when no input is required", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(AgentActivityCard, {
          activeSessionCount: 0,
          waitingForInputCount: 0,
        }),
      ),
    );

    expect(html).toContain("No sessions are waiting on user input.");
    expect(html).not.toContain("Open Agents");
  });
});
