import { expect, spyOn, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { toast } from "sonner";
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

test("prevents unsupported auxiliary and context-menu navigation", () => {
  const openExternalUrlSpy = spyOn(externalUrl, "openExternalUrl").mockResolvedValue();

  try {
    const view = renderMarkdownLink("https://example.com/context-menu", "Open link");
    const link = view.getByRole("link", { name: "Open link" });

    const auxiliaryEvent = new MouseEvent("auxclick", {
      bubbles: true,
      button: 2,
      cancelable: true,
    });
    expect(fireEvent(link, auxiliaryEvent)).toBe(false);
    expect(fireEvent.contextMenu(link)).toBe(false);
    expect(openExternalUrlSpy).not.toHaveBeenCalled();
  } finally {
    openExternalUrlSpy.mockRestore();
  }
});

test("shows an actionable error without falling back when the shell rejects a link", async () => {
  const openExternalUrlSpy = spyOn(externalUrl, "openExternalUrl").mockRejectedValue(
    new Error("Shell rejected the URL"),
  );
  const toastErrorSpy = spyOn(toast, "error").mockImplementation(() => "toast-id");

  try {
    const view = renderMarkdownLink("https://example.com/rejected", "Open link");
    const link = view.getByRole("link", { name: "Open link" });

    expect(fireEvent.click(link)).toBe(false);
    await waitFor(() => {
      expect(toastErrorSpy).toHaveBeenCalledWith("Failed to open link", {
        description: "Shell rejected the URL",
      });
    });
    expect(openExternalUrlSpy).toHaveBeenCalledTimes(1);
  } finally {
    toastErrorSpy.mockRestore();
    openExternalUrlSpy.mockRestore();
  }
});
