import { describe, expect, test, mock } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { CHAT_MARKDOWN_LINK_POLICY } from "./agent-chat-markdown-link-policy";
import { ChatFileLinkContext } from "./agent-chat-file-link-context";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";

enableReactActEnvironment();

describe("chat Markdown links", () => {
  for (const markdown of [
    "[file](src/a.ts:42)",
    "[`file`](file:///repo/a.ts#L42)",
    "[file][source]\n\n[source]: <src/a b.ts>",
    "[file](src/%E6%96%87.ts)\n\n$x^2$",
    "[file](src/a.ts)\n\n```mermaid\ngraph TD; A-->B;\n```",
    "[file](src/a.ts)\n\n$x^2$\n\n```mermaid\ngraph TD; A-->B;\n```",
    "[file](src/a.ts)\n\n![asset](odt-asset://example)",
  ]) {
    test(markdown, async () => {
      const open = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
      const view = render(
        <ChatFileLinkContext value={open}>
          <AgentChatMarkdownRenderer markdown={markdown} />
        </ChatFileLinkContext>,
      );
      try {
        await waitFor(() => expect(view.getByRole("link", { name: "file" })).toBeTruthy());
        expect(open).not.toHaveBeenCalled();
        const link = view.getByRole("link", { name: "file" });
        expect(link.getAttribute("href")).toBe("#");
        expect(link.className).toContain("focus-visible");
        fireEvent.click(link);
        expect(open).toHaveBeenCalledTimes(1);
        for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"])
          fireEvent.click(link, { [modifier]: true });
        expect(
          fireEvent(
            link,
            new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
          ),
        ).toBe(false);
        expect(open).toHaveBeenCalledTimes(1);
        link.focus();
        expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
        expect(open).toHaveBeenCalledTimes(2);
        fireEvent.keyDown(link, { key: "Enter", repeat: true });
        expect(open).toHaveBeenCalledTimes(2);
      } finally {
        view.unmount();
      }
    });
  }
  test("premium content forwards the policy", async () => {
    const open = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
    const view = render(
      <ChatFileLinkContext value={open}>
        <MarkdownRenderer
          markdown="[file](file:///repo/a.ts:42)"
          premiumCodeBlocks
          linkPolicy={CHAT_MARKDOWN_LINK_POLICY}
        />
      </ChatFileLinkContext>,
    );
    try {
      await waitFor(() => expect(view.getByRole("link")).toBeTruthy());
      fireEvent.click(view.getByRole("link"));
      expect(open.mock.calls.at(-1)?.[0]).toBe("file:///repo/a.ts:42");
    } finally {
      view.unmount();
    }
  });
  test("streaming reads only after a complete link is activated", () => {
    const open = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
    const view = render(
      <ChatFileLinkContext value={open}>
        <AgentChatMarkdownRenderer markdown="[file](src/a" streaming />
      </ChatFileLinkContext>,
    );
    try {
      expect(view.queryByRole("link")).toBeNull();
      expect(open).not.toHaveBeenCalled();
      view.rerender(
        <ChatFileLinkContext value={open}>
          <AgentChatMarkdownRenderer markdown="[file](src/a.ts)" streaming />
        </ChatFileLinkContext>,
      );
      expect(open).not.toHaveBeenCalled();
      fireEvent.click(view.getByRole("link"));
      expect(open.mock.calls.at(-1)?.[0]).toBe("src/a.ts");
    } finally {
      view.unmount();
    }
  });
  test("does not relax image URLs or non-chat Markdown", () => {
    const view = render(
      <>
        <AgentChatMarkdownRenderer markdown="![image](file:///repo/a.png)\n\n<script>bad()</script>" />
        <MarkdownRenderer markdown="[file](file:///repo/a.ts)" />
      </>,
    );
    try {
      expect(view.container.querySelector("img")?.getAttribute("src") || "").toBe("");
      expect(view.container.querySelector("script")).toBeNull();
      expect(view.container.querySelector("a")?.getAttribute("href")).toBe("");
    } finally {
      view.unmount();
    }
  });
});

test("external links keep shell behavior and unsafe schemes do not become file links", async () => {
  const external = await import("@/lib/open-external-url");
  const { spyOn } = await import("bun:test");
  const openExternal = spyOn(external, "openExternalUrl").mockResolvedValue();
  const openFile = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
  const view = render(
    <ChatFileLinkContext value={openFile}>
      <AgentChatMarkdownRenderer markdown="[web](https://example.com) [unsafe](javascript:42) [file](a.ts:42) [empty]()" />
    </ChatFileLinkContext>,
  );
  try {
    fireEvent.click(view.getByText("web"));
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
    fireEvent.click(view.getByText("unsafe"));
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openFile).not.toHaveBeenCalled();
    fireEvent.click(view.getByText("file"));
    fireEvent.click(view.getByText("empty"));
    expect(openFile.mock.calls[0]?.[0]).toBe("a.ts:42");
    expect(openFile.mock.calls[1]?.[0]).toBe("");
    expect(openExternal).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    openExternal.mockRestore();
  }
});

test("the final lazy renderers all retain the file action", async () => {
  const renderers = await Promise.all([
    import("@/components/ui/markdown-renderer-rich"),
    import("@/components/ui/markdown-renderer-math"),
    import("@/components/ui/markdown-renderer-math-candidate"),
    import("@/components/ui/markdown-renderer-mermaid-candidate"),
  ]);
  for (const { default: Renderer } of renderers) {
    const open = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
    const view = render(
      <ChatFileLinkContext value={open}>
        <Renderer
          markdown={"[file](file:///repo/a.ts:42)\n\n$x^2$\n\n```mermaid\ngraph TD; A-->B;\n```"}
          components={{ a: CHAT_MARKDOWN_LINK_POLICY.anchor }}
          linkPolicy={CHAT_MARKDOWN_LINK_POLICY}
          fallbackContent={<div>Loading</div>}
        />
      </ChatFileLinkContext>,
    );
    try {
      await waitFor(() => expect(view.getByRole("link", { name: "file" })).toBeTruthy());
      fireEvent.click(view.getByRole("link", { name: "file" }));
      expect(open.mock.calls.at(-1)?.[0]).toBe("file:///repo/a.ts:42");
    } finally {
      view.unmount();
    }
  }
});
