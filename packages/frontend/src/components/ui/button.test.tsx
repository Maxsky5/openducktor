import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button";

describe("Button", () => {
  test("owns warning variant styling", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: "warning" }, "Manual close"),
    );

    expect(html).toContain("border-warning-border");
    expect(html).toContain("bg-warning-surface");
    expect(html).toContain("text-warning-muted");
  });

  test("the toggle variant takes the selected look only when it is pressed", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: "toggle", "aria-pressed": true }, "Changed only"),
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("border-input");
    expect(html).toContain("aria-pressed:bg-sidebar-accent");
  });
});
