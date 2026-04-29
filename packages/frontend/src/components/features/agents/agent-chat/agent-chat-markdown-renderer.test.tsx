import { describe, expect, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";

enableReactActEnvironment();

describe("AgentChatMarkdownRenderer", () => {
  test("renders an in-progress fenced code block as code while streaming", async () => {
    const rendered = render(
      createElement(AgentChatMarkdownRenderer, {
        markdown: "```ts\nconst value = 1;",
        streaming: true,
      }),
    );

    try {
      await waitFor(() => {
        expect(rendered.container.textContent).toContain("const value = 1;");
      });
    } finally {
      rendered.unmount();
    }
  });

  test("keeps raw html out of rendered chat markdown", async () => {
    const rendered = render(
      createElement(AgentChatMarkdownRenderer, {
        markdown: "<script>alert('bad')</script>\n\n**safe**",
      }),
    );

    try {
      await waitFor(() => {
        expect(rendered.container.textContent).toContain("safe");
      });
      expect(rendered.container.querySelector("script")).toBeNull();
    } finally {
      rendered.unmount();
    }
  });

  test("uses the plain text path when no markdown syntax is present", () => {
    const rendered = render(
      createElement(AgentChatMarkdownRenderer, {
        markdown: "Plain transcript line",
      }),
    );

    try {
      expect(rendered.container.querySelector("p")?.textContent).toBe("Plain transcript line");
      expect(rendered.container.querySelector(".markdown-body")).toBeNull();
    } finally {
      rendered.unmount();
    }
  });

  test("preserves surrounding streaming whitespace in the rendered text", () => {
    const rendered = render(
      createElement(AgentChatMarkdownRenderer, {
        markdown: "  Plain transcript line  ",
        streaming: true,
      }),
    );

    try {
      expect(rendered.container.querySelector("p")?.textContent).toBe("  Plain transcript line  ");
    } finally {
      rendered.unmount();
    }
  });
});
