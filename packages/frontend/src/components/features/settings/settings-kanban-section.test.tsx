import { describe, expect, test } from "bun:test";
import type { KanbanSettings } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsKanbanSection } from "./settings-kanban-section";

describe("settings kanban section", () => {
  test("renders the done-task visibility setting", () => {
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
    expect(html).toContain('aria-label="Normal"');
    expect(html).toContain('aria-label="Compact"');
    expect(html).toContain("lucide-rows-3");
    expect(html).toContain("lucide-rows-2");
    expect(html).not.toContain(">Normal<");
    expect(html).not.toContain(">Compact<");
    expect(html).toContain('value="3"');
  });
});
