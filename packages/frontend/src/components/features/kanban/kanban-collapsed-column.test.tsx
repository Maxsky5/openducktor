import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KanbanCollapsedColumn } from "./kanban-collapsed-column";

describe("KanbanCollapsedColumn", () => {
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
