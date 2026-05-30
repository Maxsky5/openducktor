import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Switch } from "./switch";

describe("Switch", () => {
  test("uses switch-specific checked tokens", () => {
    const html = renderToStaticMarkup(createElement(Switch, { checked: true }));

    expect(html).toContain("data-[state=checked]:bg-switch-checked");
    expect(html).toContain("bg-switch-thumb");
    expect(html).not.toContain("data-[state=checked]:bg-primary");
    expect(html).not.toContain("bg-background");
  });
});
