import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  test("uses a single interaction ring for focus", () => {
    const html = renderToStaticMarkup(createElement(Textarea));

    expect(html).toContain("focus-visible:ring-ring/40");
    expect(html).not.toContain("focus-visible:border-ring");
  });
});
