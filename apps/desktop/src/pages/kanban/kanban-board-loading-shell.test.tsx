import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("KanbanBoardLoadingShell", () => {
  test("renders all kanban lane skeletons", async () => {
    const { KanbanBoardLoadingShell } = await import("./kanban-board-loading-shell");
    const html = renderToStaticMarkup(
      createElement(KanbanBoardLoadingShell, {
        label: "Loading tasks...",
        testId: "kanban-route-loading-overlay",
      }),
    );

    expect(html).toContain('data-testid="kanban-route-loading-overlay"');
    expect(html.match(/data-testid="kanban-loading-lane"/g)?.length).toBe(8);
    expect(html).toContain('data-slot="skeleton"');
  });
});
