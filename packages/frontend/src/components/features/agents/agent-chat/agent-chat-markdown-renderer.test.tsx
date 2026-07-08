import { describe, expect, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MARKDOWN_COMPONENTS } from "@/components/ui/markdown-renderer-components";
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

  test("keeps code blocks locally horizontally scrollable without app-hidden scrollbars", () => {
    const Pre = MARKDOWN_COMPONENTS.document.pre;
    if (typeof Pre !== "function") {
      throw new Error("Expected document markdown code blocks to use a pre component");
    }

    const rendered = render(createElement(Pre, {}, createElement("code", {}, "const value = 1;")));

    try {
      const codeBlock = rendered.container.querySelector("pre");
      expect(codeBlock).not.toBeNull();
      expect(codeBlock?.className).toContain("overflow-x-auto");
      expect(codeBlock?.className).not.toContain("hide-scrollbar");
      expect(rendered.container.innerHTML).not.toContain("hide-scrollbar");
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
      const paragraph = rendered.container.querySelector("p");
      expect(paragraph?.textContent).toBe("Plain transcript line");
      expect(paragraph?.className).toContain("break-words");
      expect(rendered.container.querySelector(".markdown-body")).toBeNull();
    } finally {
      rendered.unmount();
    }
  });

  test("wraps markdown prose without changing code block scroll behavior", async () => {
    const rendered = render(
      createElement(AgentChatMarkdownRenderer, {
        markdown: "**supercalifragilisticexpialidocioussupercalifragilisticexpialidocious**",
      }),
    );

    try {
      await waitFor(() => {
        expect(rendered.container.querySelector(".markdown-body")).not.toBeNull();
      });

      const markdownBody = rendered.container.querySelector(".markdown-body");
      expect(markdownBody?.className).toContain("prose-p:break-words");
      expect(markdownBody?.className).toContain("prose-li:break-words");
      expect(markdownBody?.className).toContain("prose-blockquote:break-words");
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
