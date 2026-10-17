import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  test("shows focus with a neutral border only", () => {
    const html = renderToStaticMarkup(createElement(Textarea));

    expect(html).toContain("focus-visible:border-ring");
    expect(html).not.toContain("focus-visible:ring");
    expect(html).not.toContain("focus-visible:shadow");
  });

  test("leaves the border and the focus to the editor of an embedded field", () => {
    const html = renderToStaticMarkup(createElement(Textarea, { embedded: true }));

    expect(html).not.toContain("border-input");
  });
});
