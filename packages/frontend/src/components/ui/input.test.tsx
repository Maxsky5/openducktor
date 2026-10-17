import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "./input";

describe("Input", () => {
  test("shows focus with a neutral border only", () => {
    const html = renderToStaticMarkup(createElement(Input));

    expect(html).toContain("focus-visible:border-ring");
    expect(html).toContain("border-input");
    expect(html).not.toContain("focus-visible:ring");
    expect(html).not.toContain("focus-visible:shadow");
  });

  test("leaves the border and the focus to the group of an embedded field", () => {
    const html = renderToStaticMarkup(createElement(Input, { embedded: true }));

    expect(html).not.toContain("border-input");
  });
});
