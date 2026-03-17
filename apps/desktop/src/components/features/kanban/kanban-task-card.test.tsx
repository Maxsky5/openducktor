import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { KanbanTaskCard } from "./kanban-task-card";

const noop = (): void => {};

describe("KanbanTaskCard active sessions", () => {
  test("renders animated active state and session links", () => {
    const task = createTaskCardFixture({ id: "TASK-1", title: "Implement payment flow" });

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          activeSessions: [
            {
              runtimeKind: "opencode",
              sessionId: "session-build",
              role: "build",
              scenario: "build_implementation_start",
              status: "running",
            },
            {
              runtimeKind: "opencode",
              sessionId: "session-qa",
              role: "qa",
              scenario: "qa_review",
              status: "starting",
            },
          ],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).toContain("kanban-active-session-card");
    expect(html).toContain("kanban-active-session-ray");
    expect(html).toContain("Active sessions");
    expect(html).toContain("Builder");
    expect(html).toContain("Running");
    expect(html).toContain("QA");
    expect(html).toContain("Starting");
    expect(html).not.toContain("Active agent session");
    expect(html).toContain(
      'href="/agents?task=TASK-1&amp;session=session-build&amp;agent=build&amp;scenario=build_implementation_start"',
    );
    expect(html).toContain(
      'href="/agents?task=TASK-1&amp;session=session-qa&amp;agent=qa&amp;scenario=qa_review"',
    );
  });

  test("does not render active sessions section when none are active", () => {
    const task = createTaskCardFixture({ id: "TASK-2", title: "Write specs" });

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          activeSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).not.toContain("kanban-active-session-card");
    expect(html).not.toContain("Active sessions");
    expect(html).not.toContain("Active agent session");
  });

  test("renders qa rejected badge for rework tasks", () => {
    const task = createTaskCardFixture({
      id: "TASK-3",
      title: "Fix OAuth flow",
      status: "in_progress",
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: true, updatedAt: "2026-02-22T10:00:00.000Z", verdict: "rejected" },
      },
    });

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          activeSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).toContain("QA Rejected");
  });

  test("renders a pull request link badge when the task is linked to a PR", () => {
    const task = createTaskCardFixture({
      id: "TASK-4",
      title: "Ship approval flow",
      pullRequest: {
        providerId: "github",
        number: 110,
        url: "https://github.com/openai/openducktor/pull/110",
        state: "open",
        createdAt: "2026-03-12T12:24:09Z",
        updatedAt: "2026-03-12T12:24:09Z",
        lastSyncedAt: undefined,
        mergedAt: undefined,
        closedAt: undefined,
      },
    });

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          activeSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).toContain("PR #110");
    expect(html).toContain("text-emerald");
  });

  test("hides terminal run badges for completed and stopped runs", () => {
    const task = createTaskCardFixture({ id: "TASK-5", title: "Wrap up docs" });

    const completedHtml = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          runState: "completed",
          activeSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );
    expect(completedHtml).not.toContain("Completed");

    const stoppedHtml = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          runState: "stopped",
          activeSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );
    expect(stoppedHtml).not.toContain("Stopped");
  });

  test("hides starting and running run badges on Kanban cards", () => {
    const task = createTaskCardFixture({ id: "TASK-6", title: "Implement auth" });

    const runningHtml = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          runState: "running",
          activeSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(runningHtml).not.toContain("Running");
    expect(runningHtml).not.toContain("lucide-loader-2");

    const startingHtml = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          runState: "starting",
          activeSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(startingHtml).not.toContain("Starting");
    expect(startingHtml).not.toContain("lucide-loader-2");
  });

  test("hides awaiting-done-confirmation run badges on Kanban cards", () => {
    const task = createTaskCardFixture({ id: "TASK-7", title: "Finalize auth" });

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          runState: "awaiting_done_confirmation",
          activeSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).not.toContain("Ready to finish");
  });
});
