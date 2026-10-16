import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Checkbox } from "./checkbox";
import { Combobox } from "./combobox";
import { RadioGroup, RadioGroupItem, RadioGroupSegmentItem } from "./radio-group";
import { SegmentedControlItem } from "./segmented-control";
import { Slider } from "./slider";
import { Switch } from "./switch";

const controls: Array<[string, ReactElement]> = [
  ["Checkbox", createElement(Checkbox, { checked: true })],
  [
    "RadioGroupItem",
    createElement(RadioGroup, { value: "a" }, createElement(RadioGroupItem, { value: "a" })),
  ],
  [
    "RadioGroupSegmentItem",
    createElement(RadioGroup, { value: "a" }, createElement(RadioGroupSegmentItem, { value: "a" })),
  ],
  ["SegmentedControlItem", createElement(SegmentedControlItem, { active: true }, "Item")],
  ["Switch", createElement(Switch, { checked: true })],
  ["Slider", createElement(Slider, { value: [50], "aria-label": "Volume" })],
];

describe("form control focus", () => {
  test.each(controls)("%s shows focus with a neutral input-focus ring", (_name, control) => {
    const html = renderToStaticMarkup(control);

    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("focus-visible:ring-input-focus");
    expect(html).not.toMatch(/focus-visible:(?:ring|border|outline)-ring\b/);
  });

  test("the Combobox trigger shows focus with a neutral border and no ring", () => {
    const html = renderToStaticMarkup(
      createElement(Combobox, { value: "", options: [], onValueChange: () => {} }),
    );

    expect(html).toContain("focus-visible:border-input-focus");
    expect(html).toContain("focus-visible:ring-0");
  });
});
