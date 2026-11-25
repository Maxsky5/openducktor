import { expect, mock, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { IsolatedMarkdownWrapper } from "@/test-utils/isolated-markdown-wrapper";

// The highlighter theme fails to load in this file only. The test runner gives each file its own
// module registry.
mock.module("@pierre/highlights/themes/pierre-dark", () => {
  throw new Error("missing dark theme");
});

const { MarkdownRenderer } = await import("./markdown-renderer");

test("shows why code has no highlighting when the highlighter does not load", async () => {
  const view = render(<MarkdownRenderer markdown={"```ts\nconst value = 1;\n```"} />, {
    wrapper: IsolatedMarkdownWrapper,
  });

  await waitFor(() =>
    expect(view.container.textContent).toContain(
      "Syntax highlighting unavailable: missing dark theme",
    ),
  );
  expect(view.container.querySelector("code")?.textContent).toContain("const value = 1;");
});
