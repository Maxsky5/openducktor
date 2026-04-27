import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";

let KanbanCollapsedColumn: typeof import("./kanban-collapsed-column").KanbanCollapsedColumn;

describe("KanbanCollapsedColumn", () => {
  beforeAll(async () => {
    const modulePath = `./kanban-collapsed-column?test=${Date.now()}`;
    const kanbanCollapsedColumnModule = (await import(modulePath)) as {
      KanbanCollapsedColumn: typeof import("./kanban-collapsed-column").KanbanCollapsedColumn;
    };
    KanbanCollapsedColumn = kanbanCollapsedColumnModule.KanbanCollapsedColumn;
  });

  test("renders a keyboard-focusable tooltip trigger without a native title", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider delayDuration={120}>
        <KanbanCollapsedColumn
          column={{
            id: "open",
            title: "Backlog",
            tasks: [],
          }}
        />
      </TooltipProvider>,
    );

    expect(html).toContain('aria-label="Backlog column is empty and collapsed"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('title="Backlog column is empty and collapsed"');
    expect(html).toContain("bg-muted-foreground/45");
  });
});
