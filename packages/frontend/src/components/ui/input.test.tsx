import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "./input";

describe("Input", () => {
  test("shows focus with the field focus style and no second ring", () => {
    const html = renderToStaticMarkup(createElement(Input));

    expect(html).toContain("focus-visible:field-focus");
    expect(html).toContain("border-input");
    expect(html).not.toContain("focus-visible:ring");
  });

  test("leaves the border and the focus to the group of an embedded field", () => {
    const html = renderToStaticMarkup(createElement(Input, { embedded: true }));

    expect(html).not.toContain("field-focus");
    expect(html).not.toContain("border-input");
  });
});
