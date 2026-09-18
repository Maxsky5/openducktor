import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import type { Components, ExtraProps } from "react-markdown";
import { type MarkdownLinkPolicy, markdownLinkComponents } from "./markdown-link-policy";
import { renderMarkdownElement } from "./markdown-render-element";

const createPolicy = (): MarkdownLinkPolicy => ({
  anchor: ({ node: _node, children, ...props }: ComponentProps<"a"> & ExtraProps) =>
    createElement("a", { ...props, "data-testid": "policy-anchor" }, children),
  handlesDestination: (href) => href.startsWith("odt:"),
});

describe("renderMarkdownElement", () => {
  test("reuses the rendered element for the same markdown and components", () => {
    const components: Components = {};

    const first = renderMarkdownElement({ markdown: "**bold**", components });
    const second = renderMarkdownElement({ markdown: "**bold**", components });

    expect(second).toBe(first);
  });

  test("keeps entries separate for distinct component sets", () => {
    const first = renderMarkdownElement({ markdown: "**bold**", components: {} });
    const second = renderMarkdownElement({ markdown: "**bold**", components: {} });

    expect(second).not.toBe(first);
  });

  test("keeps entries separate for distinct markdown", () => {
    const components: Components = {};

    const first = renderMarkdownElement({ markdown: "**bold**", components });
    const second = renderMarkdownElement({ markdown: "**other**", components });

    expect(second).not.toBe(first);
  });

  test("renders markdown content", () => {
    const view = render(
      renderMarkdownElement({
        markdown: "# Title\n\n- one\n- two\n\n```ts\nconst x = 1;\n```",
        components: {},
      }),
    );

    expect(view.getByRole("heading", { name: "Title" })).toBeDefined();
    expect(view.getAllByRole("listitem")).toHaveLength(2);
    expect(view.getByText("const x = 1;")).toBeDefined();
  });

  test("renders cached markdown again on a later render", () => {
    const components: Components = {};
    const markdown = "**cached bold**";

    const first = render(renderMarkdownElement({ markdown, components }));
    expect(first.getByText("cached bold")).toBeDefined();
    first.unmount();

    const second = render(renderMarkdownElement({ markdown, components }));
    expect(second.getByText("cached bold")).toBeDefined();
  });

  test("applies the link policy to cached elements", () => {
    const policy = createPolicy();
    const components = markdownLinkComponents({}, undefined, policy);
    const markdown = "[go](odt:task)";

    const first = renderMarkdownElement({ markdown, components, linkPolicy: policy });
    const second = renderMarkdownElement({ markdown, components, linkPolicy: policy });

    expect(second).toBe(first);
    render(first);
    expect(screen.getByTestId("policy-anchor").getAttribute("href")).toBe("#");
  });

  test("evicts the oldest entry after the cache limit", () => {
    const components: Components = {};
    const first = renderMarkdownElement({ markdown: "**entry-0**", components });

    for (let index = 1; index <= 200; index += 1) {
      renderMarkdownElement({ markdown: `**entry-${index}**`, components });
    }

    const reloaded = renderMarkdownElement({ markdown: "**entry-0**", components });

    expect(reloaded).not.toBe(first);
  });
});
