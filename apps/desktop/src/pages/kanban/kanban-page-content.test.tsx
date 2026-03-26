import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

const model: KanbanPageContentModel = {
  isLoadingTasks: false,
  isSwitchingWorkspace: false,
  columns: [
    {
      id: "open",
      title: "Backlog",
      tasks: [],
    },
  ],
  runStateByTaskId: new Map(),
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

  beforeAll(async () => {
    mock.module("@/components/features/kanban/kanban-column", () => ({
      KanbanColumn: (): ReactElement => <div data-testid="kanban-column" />,
    }));

    ({ KanbanPageContent } = await import("./kanban-page-content"));
  });

  afterAll(() => {
    mock.restore();
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
});
