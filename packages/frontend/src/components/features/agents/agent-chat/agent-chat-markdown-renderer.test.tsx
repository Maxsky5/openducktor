import { describe, expect, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";

enableReactActEnvironment();

describe("AgentChatMarkdownRenderer", () => {
  test("renders completed markdown without a plain-text first frame", () => {
    const rendered = render(
      createElement(AgentChatMarkdownRenderer, {
        markdown: "Persisted the **canonical spec**.\n\n- First requirement\n- Second requirement",
      }),
    );

    try {
      expect(rendered.container.querySelector(".markdown-body")).not.toBeNull();
      expect(rendered.container.querySelector("strong")?.textContent).toBe("canonical spec");
      expect(rendered.container.querySelectorAll("li")).toHaveLength(2);
    } finally {
      rendered.unmount();
    }
  });

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

  test("keeps code blocks locally horizontally scrollable without app-hidden scrollbars", async () => {
    const rendered = render(
      createElement(AgentChatMarkdownRenderer, {
        markdown: "```ts\nconst value = 1;\n```",
      }),
    );

    try {
      await waitFor(() => {
        expect(rendered.container.querySelector("pre")).not.toBeNull();
      });
      const codeBlock = rendered.container.querySelector("pre");
      expect(codeBlock).not.toBeNull();
      expect(codeBlock?.className).toContain("overflow-x-auto");
      expect(codeBlock?.className).not.toContain("hide-scrollbar");
      expect(rendered.container.innerHTML).not.toContain("hide-scrollbar");
    } finally {
      rendered.unmount();
    }
  });

  test("keeps one rendered markdown tree while streaming syntax arrives", () => {
    const rendered = render(
      createElement(AgentChatMarkdownRenderer, {
        markdown: "Plain transcript line",
        streaming: true,
      }),
    );

    try {
      const initialRoot = rendered.container.firstElementChild;
      expect(initialRoot?.classList.contains("markdown-body")).toBe(true);

      rendered.rerender(
        createElement(AgentChatMarkdownRenderer, {
          markdown: "Plain transcript line with **emphasis**",
          streaming: true,
        }),
      );

      expect(rendered.container.firstElementChild).toBe(initialRoot);
      expect(rendered.container.querySelector("strong")?.textContent).toBe("emphasis");
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
});
