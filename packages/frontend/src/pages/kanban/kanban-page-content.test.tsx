import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { KanbanTaskActivityState } from "@/components/features/kanban/kanban-task-activity";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { KanbanPageContent } from "./kanban-page-content";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

const visibleTask = createTaskCardFixture({
  id: "TASK-1",
  title: "Visible task",
  status: "in_progress",
});
const visibleTaskActivityState = new Map<string, KanbanTaskActivityState>([["TASK-1", "idle"]]);

const model: KanbanPageContentModel = {
  isLoadingTasks: false,
  isSwitchingWorkspace: false,
  emptyColumnDisplay: "show",
  showHorizontalScrollbars: false,
  columns: [
    {
      id: "open",
      title: "Backlog",
      tasks: [],
    },
  ],
  taskSessionsByTaskId: new Map(),
  historicalSessionsByTaskId: new Map(),
  activeTaskSessionContextByTaskId: new Map(),
  taskActivityStateByTaskId: new Map(),
  onOpenDetails: () => {},
  onDelegate: () => {},
  onOpenSession: () => {},
  onPlan: () => {},
  onQaStart: () => {},
  onQaOpen: () => {},
  onBuild: () => {},
  onHumanApprove: () => {},
  onHumanRequestChanges: () => {},
  onResetImplementation: () => {},
};

describe("KanbanPageContent", () => {
  test("keeps the horizontal scroll region stretched across the remaining page height", () => {
    const html = renderToStaticMarkup(createElement(KanbanPageContent, { model }));

    expect(html).toContain("flex-1");
    expect(html).toContain("w-full");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("overflow-y-visible");
    expect(html).toContain("min-h-full");
    expect(html).toContain("hide-scrollbar");
  });

  test("omits scrollbar hiding when horizontal scrollbars should be visible", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          showHorizontalScrollbars: true,
        },
      }),
    );

    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("hide-scrollbar");
  });

  test("renders a blocking board loader while the initial task load is in progress", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          isLoadingTasks: true,
        },
      }),
    );

    expect(html).toContain('data-testid="kanban-loading-overlay"');
    expect(html.match(/data-testid="kanban-loading-lane"/g)?.length).toBe(8);
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain('data-testid="kanban-refresh-indicator"');
  });

  test("does not render a refresh indicator when tasks are already visible", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          isLoadingTasks: true,
          columns: [
            {
              id: "open",
              title: "Backlog",
              tasks: [visibleTask],
            },
          ],
          taskActivityStateByTaskId: visibleTaskActivityState,
        },
      }),
    );

    expect(html).not.toContain('data-testid="kanban-refresh-indicator"');
    expect(html).not.toContain("Refreshing tasks...");
    expect(html).not.toContain('data-testid="kanban-loading-overlay"');
  });

  test("shows empty columns when the display mode is show", () => {
    const html = renderToStaticMarkup(createElement(KanbanPageContent, { model }));

    expect(html).toContain("Backlog");
    expect(html).not.toContain("Backlog column is empty and collapsed");
  });

  test("hides empty columns when the display mode is hidden", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          emptyColumnDisplay: "hidden",
        },
      }),
    );

    expect(html).not.toContain("Backlog");
    expect(html).not.toContain("Backlog column is empty and collapsed");
  });

  test("collapses empty columns without collapsing populated columns", () => {
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          emptyColumnDisplay: "collapsed",
          columns: [
            ...model.columns,
            {
              id: "in_progress",
              title: "In progress",
              tasks: [visibleTask],
            },
          ],
          taskActivityStateByTaskId: visibleTaskActivityState,
        },
      }),
    );

    expect(html).toContain("Backlog column is empty and collapsed");
    expect(html).toContain("In progress");
    expect(html).toContain("Visible task");
  });
});
