import { describe, expect, test } from "bun:test";
import { createElement, type ComponentProps } from "react";
import type { Components, ExtraProps } from "react-markdown";
import { markdownLinkComponents, type MarkdownLinkPolicy } from "./markdown-link-policy";

const createPolicy = (): MarkdownLinkPolicy => ({
  anchor: ({ node: _node, children, ...props }: ComponentProps<"a"> & ExtraProps) =>
    createElement("a", props, children),
  handlesDestination: (href) => href.startsWith("odt:"),
});

describe("markdownLinkComponents", () => {
  test("returns the defaults when no overrides or policy apply", () => {
    const defaults: Components = {};

    expect(markdownLinkComponents(defaults, undefined, undefined)).toBe(defaults);
  });

  test("reuses one component set for repeated calls with the same inputs", () => {
    const defaults: Components = {};
    const policy = createPolicy();

    const first = markdownLinkComponents(defaults, undefined, policy);
    const second = markdownLinkComponents(defaults, undefined, policy);

    expect(second).toBe(first);
    expect(first.a).toBe(policy.anchor);
  });

  test("builds a distinct component set for a distinct policy", () => {
    const defaults: Components = {};

    const first = markdownLinkComponents(defaults, undefined, createPolicy());
    const second = markdownLinkComponents(defaults, undefined, createPolicy());

    expect(second).not.toBe(first);
  });

  test("builds a distinct component set for distinct overrides", () => {
    const defaults: Components = {};
    const overrides: Components = { strong: () => null };

    const first = markdownLinkComponents(defaults, overrides, undefined);
    const second = markdownLinkComponents(defaults, undefined, undefined);

    expect(first).not.toBe(second);
    expect(first.strong).toBe(overrides.strong);
  });
});
