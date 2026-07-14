import { expect, spyOn, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import * as externalUrl from "@/lib/open-external-url";
import { MARKDOWN_COMPONENTS } from "./markdown-renderer-components";

const renderMarkdownLink = (href: string, label: string) => {
  const MarkdownLink = MARKDOWN_COMPONENTS.document.a;
  if (typeof MarkdownLink !== "function") {
    throw new Error("Expected the shared Markdown anchor to be a React component.");
  }
  return render(createElement(MarkdownLink, { href }, label));
};

test("opens rendered links through the external URL shell bridge", () => {
  const openExternalUrlSpy = spyOn(externalUrl, "openExternalUrl").mockResolvedValue();
  const markdownUrl = "https://example.com/docs";

  try {
    const view = renderMarkdownLink(markdownUrl, "Open docs");
    const link = view.getByRole("link", { name: "Open docs" });

    expect(link.getAttribute("href")).toBe(markdownUrl);
    expect(link.getAttribute("target")).toBeNull();
    expect(fireEvent.click(link)).toBe(false);
    expect(openExternalUrlSpy).toHaveBeenCalledWith(markdownUrl);
  } finally {
    openExternalUrlSpy.mockRestore();
  }
});

test("opens rendered links through the shell bridge on middle click", () => {
  const openExternalUrlSpy = spyOn(externalUrl, "openExternalUrl").mockResolvedValue();
  const markdownUrl = "https://example.com/middle-click";

  try {
    const view = renderMarkdownLink(markdownUrl, "Open link");
    const link = view.getByRole("link", { name: "Open link" });

    const event = new MouseEvent("auxclick", { bubbles: true, button: 1, cancelable: true });
    expect(fireEvent(link, event)).toBe(false);
    expect(openExternalUrlSpy).toHaveBeenCalledWith(markdownUrl);
  } finally {
    openExternalUrlSpy.mockRestore();
  }
});
