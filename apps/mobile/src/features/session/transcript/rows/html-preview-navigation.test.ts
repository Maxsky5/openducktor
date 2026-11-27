import { describe, expect, test } from "bun:test";
import { allowsHtmlPreviewRequest } from "./html-preview-navigation";

describe("preview navigation guard", () => {
  test("allows only the first wrapper load and same-document fragment links", () => {
    expect(allowsHtmlPreviewRequest("about:blank", false)).toBe(true);
    expect(allowsHtmlPreviewRequest("about:blank", true)).toBe(false);
    expect(allowsHtmlPreviewRequest("about:blank#design", true)).toBe(true);
    expect(allowsHtmlPreviewRequest("about:srcdoc", false)).toBe(true);
    expect(allowsHtmlPreviewRequest("about:srcdoc#design", true)).toBe(true);
  });

  test("blocks every other request", () => {
    for (const url of [
      "https://example.test/page",
      "http://127.0.0.1:14328/api",
      "file:///private/note.txt",
      "data:text/html,<p>next</p>",
      "about:blank?next",
    ]) {
      expect(allowsHtmlPreviewRequest(url, true)).toBe(false);
    }
  });
});
