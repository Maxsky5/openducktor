import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Combobox } from "./combobox";
import { RadioGroup, RadioGroupItem, RadioGroupSegmentItem } from "./radio-group";
import { SegmentedControlItem } from "./segmented-control";
import { Slider } from "./slider";
import { Switch } from "./switch";

const controls: Array<[string, ReactElement]> = [
  ["Button", createElement(Button, null, "Save")],
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

/** The chroma of the first `--ring` value after the theme selector in the global styles. */
const ringChroma = (themeSelector: ":root," | ".dark {"): number => {
  const styles = readFileSync(resolve(import.meta.dir, "../../styles.css"), "utf8");
  const theme = styles.slice(styles.indexOf(themeSelector));
  const chroma = theme.match(/--ring: oklch\([\d.]+ ([\d.]+)/)?.[1];
  if (!chroma) throw new Error(`Expected an oklch --ring value after ${themeSelector}`);
  return Number(chroma);
};

describe("control focus", () => {
  test.each([":root,", ".dark {"] as const)("%s uses a neutral ring color", (themeSelector) => {
    expect(ringChroma(themeSelector)).toBeLessThan(0.06);
  });

  test.each(controls)("%s shows focus with a solid 2px ring", (_name, control) => {
    const html = renderToStaticMarkup(control);

    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("focus-visible:ring-ring");
    expect(html).not.toMatch(/focus-visible:ring-ring\//);
  });

  test("the Combobox trigger shows focus with a border and no ring", () => {
    const html = renderToStaticMarkup(
      createElement(Combobox, { value: "", options: [], onValueChange: () => {} }),
    );

    expect(html).toContain("focus-visible:border-ring");
    expect(html).toContain("focus-visible:ring-0");
  });
});
