import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "./input";

describe("Input", () => {
  test("uses a single interaction ring for focus", () => {
    const html = renderToStaticMarkup(createElement(Input));

    expect(html).toContain("focus-visible:ring-ring/40");
    expect(html).not.toContain("focus-visible:border-ring");
  });
});
