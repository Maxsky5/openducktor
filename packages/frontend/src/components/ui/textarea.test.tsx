import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  test("shows focus with the field focus style and no second ring", () => {
    const html = renderToStaticMarkup(createElement(Textarea));

    expect(html).toContain("focus-visible:field-focus");
    expect(html).not.toContain("focus-visible:ring");
  });

  test("leaves the border and the focus to the editor of an embedded field", () => {
    const html = renderToStaticMarkup(createElement(Textarea, { embedded: true }));

    expect(html).not.toContain("field-focus");
    expect(html).not.toContain("border-input");
  });
});
