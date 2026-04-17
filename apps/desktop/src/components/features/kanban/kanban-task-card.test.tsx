import { describe, expect, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { KanbanTaskCard } from "./kanban-task-card";

const noop = (): void => {};

enableReactActEnvironment();

const installMockResizeObserver = () => {
  const globalWithResizeObserver = globalThis as typeof globalThis & {
    ResizeObserver?: typeof ResizeObserver;
  };
  const previousResizeObserver = globalWithResizeObserver.ResizeObserver;
  const activeCallbacks = new Set<ResizeObserverCallback>();

  class MockResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(_target: Element): void {
      activeCallbacks.add(this.callback);
    }

    unobserve(_target: Element): void {}

    disconnect(): void {
      activeCallbacks.delete(this.callback);
    }
  }

  globalWithResizeObserver.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

  return {
    trigger: (): void => {
      for (const callback of [...activeCallbacks]) {
        callback([], {} as ResizeObserver);
      }
    },
    restore: (): void => {
      if (typeof previousResizeObserver === "undefined") {
        delete globalWithResizeObserver.ResizeObserver;
        return;
      }

      globalWithResizeObserver.ResizeObserver = previousResizeObserver;
    },
  };
};

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

  test("renders filtered task labels, moves task id into metadata, and removes visible open text", () => {
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
    expect(html).not.toContain("phase:open");
    expect(html).toContain("TASK-8");
    expect(html.indexOf("Feature")).toBeLessThan(html.indexOf("P1"));
    expect(html.indexOf("P1")).toBeLessThan(html.indexOf("TASK-8"));
    expect(html).toContain('data-testid="kanban-open-details-affordance"');
    expect(html).not.toContain(">Open<");
    expect(html).toContain("lucide-tag");
  });

  test("omits the label row when only phase labels exist", () => {
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

    expect(html).not.toContain('data-testid="kanban-task-label-row"');
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

  test("hides terminal run badges for completed and stopped runs", () => {
    const task = createTaskCardFixture({ id: "TASK-5", title: "Wrap up docs" });

    const completedHtml = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(KanbanTaskCard, {
          task,
          runState: "completed",
          taskActivityState: "idle",
          taskSessions: [],
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
          taskActivityState: "idle",
          taskSessions: [],
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
          taskActivityState: "idle",
          taskSessions: [],
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
          taskActivityState: "idle",
          taskSessions: [],
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
          taskActivityState: "idle",
          taskSessions: [],
          onOpenDetails: noop,
          onDelegate: noop,
          onPlan: noop,
          onBuild: noop,
        }),
      ),
    );

    expect(html).not.toContain("Ready to finish");
  });

  test("shows a +N overflow chip and tooltip with hidden labels when labels exceed one row", async () => {
    const resizeObserver = installMockResizeObserver();
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.testid === "kanban-task-label-row" ? 190 : 0;
      },
    });

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      const text = this.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const widthByText: Record<string, number> = {
        frontend: 68,
        backend: 66,
        ops: 40,
        urgent: 54,
        "+4": 34,
      };
      const width = widthByText[text] ?? 0;

      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 24,
        right: width,
        width,
        height: 24,
        toJSON: () => ({}),
      } as DOMRect;
    };

    try {
      await act(async () => {
        render(
          <MemoryRouter initialEntries={["/kanban"]}>
            <KanbanTaskCard
              task={createTaskCardFixture({
                id: "TASK-10",
                labels: ["frontend", "backend", "ops", "urgent"],
              })}
              taskActivityState="idle"
              taskSessions={[]}
              onOpenDetails={noop}
              onDelegate={noop}
              onPlan={noop}
              onBuild={noop}
            />
          </MemoryRouter>,
        );
      });

      await act(async () => {
        resizeObserver.trigger();
      });

      await waitFor(
        () => {
          expect(screen.getByTestId("kanban-task-label-overflow").textContent).toBe("+2");
        },
        { timeout: 500 },
      );

      await waitFor(
        () => {
          const tooltip = screen.getByTestId("kanban-task-label-tooltip");
          expect(tooltip.textContent).toContain("ops");
          expect(tooltip.textContent).toContain("urgent");
        },
        { timeout: 500 },
      );
    } finally {
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
      }
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      resizeObserver.restore();
    }
  }, 3000);

  test("keeps visible labels whole and collapses overflow as full chips", async () => {
    const resizeObserver = installMockResizeObserver();
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.testid === "kanban-task-label-row" ? 170 : 0;
      },
    });

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      const text = this.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const widthByText: Record<string, number> = {
        "quality-gate": 96,
        "queued-review": 104,
        "+2": 36,
      };
      const width = widthByText[text] ?? 0;

      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 24,
        right: width,
        width,
        height: 24,
        toJSON: () => ({}),
      } as DOMRect;
    };

    try {
      await act(async () => {
        render(
          <MemoryRouter initialEntries={["/kanban"]}>
            <KanbanTaskCard
              task={createTaskCardFixture({
                id: "TASK-11",
                labels: ["quality-gate", "queued-review", "ops"],
              })}
              taskActivityState="idle"
              taskSessions={[]}
              onOpenDetails={noop}
              onDelegate={noop}
              onPlan={noop}
              onBuild={noop}
            />
          </MemoryRouter>,
        );
      });

      await act(async () => {
        resizeObserver.trigger();
      });

      await waitFor(() => {
        const labelRow = screen.getByTestId("kanban-task-label-row");
        expect(labelRow.textContent).toContain("quality-gate");
        expect(labelRow.textContent).toContain("+2");
        expect(labelRow.querySelector('[title="quality-gate"]')).toBeTruthy();
        expect(labelRow.querySelector('[title="queued-review"]')).toBeNull();
      });
    } finally {
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
      }
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      resizeObserver.restore();
    }
  });
});
