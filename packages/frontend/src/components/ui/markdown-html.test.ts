import { expect, test } from "bun:test";
import { createHtmlRenderer } from "@pierre/words/html";
import { createMarkdownHooks } from "./markdown-html";

test("shows why code has no highlighting under each code block", () => {
  const renderer = createHtmlRenderer({
    math: false,
    controls: false,
    lineNumbers: false,
    components: createMarkdownHooks({
      links: null,
      images: null,
      taskItems: false,
      codeFailure: "missing <theme>",
    }),
  });
  const html = renderer.render("```ts\nconst value = 1;\n```\n\nAfter", false, false).html;
  const block = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector('[data-markdown="code-block"]');

  expect(block?.querySelector("code")?.textContent).toContain("const value = 1;");
  expect(block?.querySelector("pre + p")?.textContent).toBe(
    "Syntax highlighting unavailable: missing <theme>",
  );
});
