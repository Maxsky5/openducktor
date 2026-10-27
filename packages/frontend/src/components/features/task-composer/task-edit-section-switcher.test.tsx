import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskEditSectionSwitcher } from "./task-edit-section-switcher";

describe("TaskEditSectionSwitcher", () => {
  test("uses segmented-button semantics instead of incomplete tab roles", () => {
    const html = renderToStaticMarkup(
      createElement(TaskEditSectionSwitcher, {
        section: "details",
        dirtyDocuments: { spec: true, plan: false },
        onSectionChange: () => {},
      }),
    );

    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });
});
