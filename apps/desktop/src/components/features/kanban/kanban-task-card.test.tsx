import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { KanbanTaskCard } from "./kanban-task-card";

const noop = (): void => {};

describe("KanbanTaskCard active sessions", () => {
  test("renders active-session primary action and removes sessions section", () => {
    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Implement payment flow",
      availableActions: ["build_start", "open_builder", "open_qa"],
      agentSessions: [
        {
          sessionId: "session-spec-old",
          externalSessionId: "external-spec-old",
          role: "spec",
          scenario: "spec_initial",
          startedAt: "2026-01-10T10:00:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/spec",
          selectedModel: null,
        },
      ],
    });

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          taskActivityState: "active",
          hasActiveSession: true,
          activeSessionRole: "build",
          taskSessions: [
            {
              runtimeKind: "opencode",
              sessionId: "session-build",
              role: "build",
              scenario: "build_implementation_start",
              status: "running",
              presentationState: "active",
            },
            {
              runtimeKind: "opencode",
              sessionId: "session-qa",
              role: "qa",
              scenario: "qa_review",
              status: "starting",
              presentationState: "active",
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
    expect(html).toContain("Builder");
    expect(html).toContain("Running");
    expect(html).toContain("lucide-circle-play");
    expect(html).toContain('data-slot="popover-trigger"');
    expect(html.split("kanban-active-session-ray")).toHaveLength(2);
    expect(html).not.toContain("Start Builder");
    expect(html).not.toContain("Start Spec");
    expect(html).not.toContain("Start Planner");
    expect(html).not.toContain("Request QA Review");
    expect(html).not.toContain("Sessions");
  });

  test("shows historical role view actions when there is no active session", () => {
    const task = createTaskCardFixture({
      id: "TASK-2",
      title: "Write specs",
      availableActions: ["build_start"],
      agentSessions: [
        {
          sessionId: "session-planner",
          externalSessionId: "external-planner",
          role: "planner",
          scenario: "planner_initial",
          startedAt: "2026-01-11T10:00:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/planner",
          selectedModel: null,
        },
        {
          sessionId: "session-spec",
          externalSessionId: "external-spec",
          role: "spec",
          scenario: "spec_initial",
          startedAt: "2026-01-10T10:00:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/spec",
          selectedModel: null,
        },
      ],
    });

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          taskActivityState: "idle",
          taskSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).not.toContain("kanban-active-session-card");
    expect(html).toContain("Start Builder");
    expect(html).toContain('data-slot="popover-trigger"');
    expect(html).not.toContain("Sessions");
  });

  test("renders waiting-input active primary style and suppresses the animated ray", () => {
    const task = createTaskCardFixture({ id: "TASK-WAITING", title: "Need approval" });

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          taskActivityState: "waiting_input",
          hasActiveSession: true,
          activeSessionRole: "build",
          taskSessions: [
            {
              runtimeKind: "opencode",
              sessionId: "session-build",
              role: "build",
              scenario: "build_implementation_start",
              status: "running",
              presentationState: "waiting_input",
            },
            {
              runtimeKind: "opencode",
              sessionId: "session-qa",
              role: "qa",
              scenario: "qa_review",
              status: "running",
              presentationState: "active",
            },
          ],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).toContain("kanban-waiting-input-card");
    expect(html).not.toContain("kanban-active-session-ray");
    expect(html).toContain("Builder");
    expect(html).toContain("Waiting input");
    expect(html).toContain("lucide-circle-play");
    expect(html).toContain("border-warning-border");
    expect(html).toContain("bg-warning-surface");
    expect(html).not.toContain("Sessions");
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
          taskActivityState: "idle",
          taskSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).toContain("QA Rejected");
  });

  test("renders task labels alongside the current task header layout", () => {
    const task = createTaskCardFixture({
      id: "TASK-8",
      title: "Polish Kanban metadata",
      issueType: "feature",
      priority: 1,
      labels: ["frontend", "phase:open", "ux"],
    });

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          taskActivityState: "idle",
          taskSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).toContain("frontend");
    expect(html).toContain("ux");
    expect(html).toContain("phase:open");
    expect(html).toContain("TASK-8");
    expect(html).toContain("Feature");
    expect(html).toContain("P1");
    expect(html).toContain(">Open<");
    expect(html).toContain("lucide-tag");
  });

  test("renders the label row even when labels use phase prefixes", () => {
    const task = createTaskCardFixture({
      id: "TASK-9",
      labels: ["phase:open", "phase:ready_for_dev"],
    });

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          taskActivityState: "idle",
          taskSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).toContain('data-testid="kanban-task-label-row"');
    expect(html).toContain("phase:open");
    expect(html).toContain("phase:ready_for_dev");
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
          taskActivityState: "idle",
          taskSessions: [],
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
});
