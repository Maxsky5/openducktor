import { describe, expect, test } from "bun:test";
import type { KanbanSettings } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsKanbanSection } from "./settings-kanban-section";

describe("settings kanban section", () => {
  test("renders the Kanban settings with the selected task card view", () => {
    const kanban: KanbanSettings = {
      doneVisibleDays: 3,
      emptyColumnDisplay: "collapsed",
      taskCardView: "compact",
    };

    const html = renderToStaticMarkup(
      createElement(SettingsKanbanSection, {
        kanban,
        disabled: false,
        onUpdateKanban: () => kanban,
      }),
    );

    expect(html).toContain("Kanban Settings");
    expect(html).toContain("Done tasks visible for");
    expect(html).toContain("Empty columns");
    expect(html).toContain("Choose whether empty lanes stay visible");
    expect(html).toContain("Task card view");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-labelledby="kanban-task-card-view-label"');
    expect(html).toContain('aria-label="Normal"');
    expect(html).toContain('aria-label="Compact"');
    expect(html.indexOf("lucide-rows-2")).toBeLessThan(html.indexOf("lucide-rows-3"));
    expect(html).not.toContain(">Normal<");
    expect(html).not.toContain(">Compact<");
    const compactOption = html.match(/<button[^>]*aria-label="Compact"[^>]*>/)?.[0];
    expect(compactOption).toContain('data-state="checked"');
    expect(html).toContain('value="3"');
  });
});
