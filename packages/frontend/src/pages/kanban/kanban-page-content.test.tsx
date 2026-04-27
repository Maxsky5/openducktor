import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

const model: KanbanPageContentModel = {
  isLoadingTasks: false,
  isSwitchingWorkspace: false,
  emptyColumnDisplay: "show",
  columns: [
    {
      id: "open",
      title: "Backlog",
      tasks: [],
    },
  ],
  taskSessionsByTaskId: new Map(),
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
  let KanbanPageContent: typeof import("./kanban-page-content").KanbanPageContent;

  beforeEach(async () => {
    mock.module("@/components/features/kanban/kanban-column", () => ({
      KanbanColumn: ({ column }: { column: (typeof model.columns)[number] }): ReactElement => (
        <div data-testid="kanban-column">{column.title}</div>
      ),
    }));
    mock.module("@/components/features/kanban/kanban-collapsed-column", () => ({
      KanbanCollapsedColumn: ({
        column,
      }: {
        column: (typeof model.columns)[number];
      }): ReactElement => <div data-testid="kanban-collapsed-column">{column.title}</div>,
    }));

    ({ KanbanPageContent } = await import("./kanban-page-content"));
  });

  afterEach(async () => {
    await restoreMockedModules([
      [
        "@/components/features/kanban/kanban-column",
        () => import("@/components/features/kanban/kanban-column"),
      ],
      [
        "@/components/features/kanban/kanban-collapsed-column",
        () => import("@/components/features/kanban/kanban-collapsed-column"),
      ],
    ]);
  });

  test("keeps the horizontal scroll region stretched across the remaining page height", () => {
    const html = renderToStaticMarkup(createElement(KanbanPageContent, { model }));

    expect(html).toContain("flex-1");
    expect(html).toContain("w-full");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("overflow-y-visible");
    expect(html).toContain("min-h-full");
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
              tasks: [{ id: "TASK-1" }] as (typeof model.columns)[number]["tasks"],
            },
          ],
        },
      }),
    );

    expect(html).not.toContain('data-testid="kanban-refresh-indicator"');
    expect(html).not.toContain("Refreshing tasks...");
    expect(html).not.toContain('data-testid="kanban-loading-overlay"');
  });

  test("shows empty columns when the display mode is show", () => {
    const html = renderToStaticMarkup(createElement(KanbanPageContent, { model }));

    expect(html.match(/data-testid="kanban-column"/g)?.length).toBe(1);
    expect(html).toContain("Backlog");
    expect(html).not.toContain('data-testid="kanban-collapsed-column"');
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

    expect(html).not.toContain('data-testid="kanban-column"');
    expect(html).not.toContain('data-testid="kanban-collapsed-column"');
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
              tasks: [{ id: "TASK-1" }] as (typeof model.columns)[number]["tasks"],
            },
          ],
        },
      }),
    );

    expect(html.match(/data-testid="kanban-collapsed-column"/g)?.length).toBe(1);
    expect(html.match(/data-testid="kanban-column"/g)?.length).toBe(1);
    expect(html).toContain("Backlog");
    expect(html).toContain("In progress");
  });
});
