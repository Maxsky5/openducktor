import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentedControlItem, SegmentedControlRoot } from "./segmented-control";
import { segmentedControlTriggerClassName } from "./segmented-control-classnames";

describe("SegmentedControl", () => {
  test("owns active item selected-control styling", () => {
    const html = renderToStaticMarkup(
      createElement(
        SegmentedControlRoot,
        { size: "md" },
        createElement(SegmentedControlItem, { active: true }, "Selected"),
        createElement(SegmentedControlItem, { active: false }, "Other"),
      ),
    );

    expect(html).toContain("bg-selected-control");
    expect(html).toContain("text-selected-control-foreground");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("bg-primary text-primary-foreground");
  });

  test("maps tab items to selected state without pressed state", () => {
    const html = renderToStaticMarkup(
      createElement(
        SegmentedControlRoot,
        { role: "tablist", size: "md" },
        createElement(SegmentedControlItem, { active: true, role: "tab" }, "Selected"),
      ),
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain("aria-pressed");
  });

  test("owns active Radix trigger selected-control styling", () => {
    const className = segmentedControlTriggerClassName({ size: "sm" });

    expect(className).toContain("data-[state=active]:bg-selected-control");
    expect(className).toContain("data-[state=active]:text-selected-control-foreground");
    expect(className).not.toContain("data-[state=active]:bg-primary");
  });
});
