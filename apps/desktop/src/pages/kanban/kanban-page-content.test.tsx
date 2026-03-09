import { describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

mock.module("@/components/features/kanban", () => ({
  KanbanColumn: (): ReactElement => <div data-testid="kanban-column" />,
}));

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
  activeSessionsByTaskId: new Map(),
  onOpenDetails: () => {},
  onDelegate: () => {},
  onPlan: () => {},
  onBuild: () => {},
  onHumanApprove: () => {},
  onHumanRequestChanges: () => {},
};

describe("KanbanPageContent", () => {
  test("keeps the horizontal scroll region stretched across the remaining page height", async () => {
    const { KanbanPageContent } = await import("./kanban-page-content");
    const html = renderToStaticMarkup(createElement(KanbanPageContent, { model }));

    expect(html).toContain("flex-1");
    expect(html).toContain("h-full");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("w-full");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("overflow-y-hidden");
    expect(html).toContain("min-h-full");
  });

  test("renders a blocking board loader while the initial task load is in progress", async () => {
    const { KanbanPageContent } = await import("./kanban-page-content");
    const html = renderToStaticMarkup(
      createElement(KanbanPageContent, {
        model: {
          ...model,
          isLoadingTasks: true,
        },
      }),
    );

    expect(html).toContain('data-testid="kanban-loading-overlay"');
    expect(html).toContain("Loading tasks...");
    expect(html).not.toContain('data-testid="kanban-refresh-indicator"');
  });

  test("renders a non-blocking refresh indicator when tasks are already visible", async () => {
    const { KanbanPageContent } = await import("./kanban-page-content");
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

    expect(html).toContain('data-testid="kanban-refresh-indicator"');
    expect(html).toContain("Refreshing tasks...");
    expect(html).not.toContain('data-testid="kanban-loading-overlay"');
  });
});
