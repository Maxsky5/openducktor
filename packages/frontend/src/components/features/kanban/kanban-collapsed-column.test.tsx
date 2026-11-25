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
            label: "Backlog",
            title: "Backlog",
            shortLabel: "Backlog",
            tone: "neutral",
            taskOrder: "priority_then_created",
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

  test("shows the column title as a vertical label", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider delayDuration={120}>
        <KanbanCollapsedColumn
          column={{
            id: "triage",
            label: "Triage",
            title: "Needs triage",
            shortLabel: "Triage",
            tone: "neutral",
            taskOrder: "priority_then_created",
            tasks: [],
          }}
        />
      </TooltipProvider>,
    );

    expect(html).toMatch(
      /<span class="[^"]*\[writing-mode:vertical-rl\][^"]*">Needs triage<\/span>/,
    );
  });
});
