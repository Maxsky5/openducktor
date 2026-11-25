import { createShellBridgeFixture, withShellPlatform } from "@/test-utils/focused-fixture";
import { beforeAll, describe, expect, test, mock } from "bun:test";
import { act, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MermaidSvgCacheProvider } from "@/components/ui/markdown-mermaid-svg-cache-context";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { CHAT_MARKDOWN_LINK_POLICY } from "./agent-chat-markdown-link-policy";
import { ChatFileLinkContext } from "./agent-chat-file-link-context";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";

const render = (element: ReactElement) => renderView(element, { wrapper: MermaidSvgCacheProvider });

beforeAll(async () => {
  await Promise.all([
    import("@/components/ui/markdown-renderer-premium"),
    import("@/components/ui/markdown-renderer-rich"),
  ]);
});

describe("chat Markdown links", () => {
  test.each([
    ["inline code", "[`file`](file:///repo/a.ts#L42)", "file:///repo/a.ts#L42"],
    ["references", "[file][source]\n\n[source]: <src/a b.ts>", "src/a%20b.ts"],
    ["math", "[file](src/%E6%96%87.ts)\n\n$x^2$", "src/%E6%96%87.ts"],
    ["a diagram", "[file](src/a.ts)\n\n```mermaid\ngraph TD; A-->B;\n```", "src/a.ts"],
    [
      "math and a diagram",
      "[file](src/a.ts)\n\n$x^2$\n\n```mermaid\ngraph TD; A-->B;\n```",
      "src/a.ts",
    ],
  ])("opens a file link with %s", async (_name, markdown, href) => {
    const open = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ChatFileLinkContext value={open}>
          <AgentChatMarkdownRenderer markdown={markdown} />
        </ChatFileLinkContext>,
      );
    });
    const link = view.getByRole("link", { name: "file" });
    if (!(link instanceof HTMLAnchorElement)) throw new Error("Expected an anchor.");
    expect(link.getAttribute("href")).toBe("#");
    fireEvent.click(link);
    expect(open.mock.calls).toEqual([[href, link]]);
  });

  test("opens a file link on click and Enter, and ignores modified input", () => {
    const open = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
    const view = render(
      <ChatFileLinkContext value={open}>
        <AgentChatMarkdownRenderer markdown="[file](src/a.ts:42)" />
      </ChatFileLinkContext>,
    );
    const link = view.getByRole("link", { name: "file" });
    if (!(link instanceof HTMLAnchorElement)) throw new Error("Expected an anchor.");
    expect(open).not.toHaveBeenCalled();
    expect(link.getAttribute("href")).toBe("#");
    expect(link.className).toContain("focus-visible");
    fireEvent.click(link);
    expect(open.mock.calls).toEqual([["src/a.ts:42", link]]);
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
      fireEvent.click(link, { [modifier]: true });
    }
    expect(
      fireEvent(link, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true })),
    ).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    link.focus();
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
    expect(open).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(link, { key: "Enter", repeat: true });
    expect(open).toHaveBeenCalledTimes(2);
  });

  test("keeps file links active beside a blocked task asset in chat", async () => {
    const open = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ChatFileLinkContext value={open}>
          <AgentChatMarkdownRenderer markdown="[file](src/a.ts)\n\n![asset](odt-asset://example)" />
        </ChatFileLinkContext>,
      );
    });
    try {
      const link = view.getByRole("link", { name: "file" });
      expect(view.getByRole("alert").textContent).toContain("task asset reference is invalid");
      expect(view.queryByRole("img")).toBeNull();
      fireEvent.click(link);
      expect(open.mock.calls.at(-1)?.[0]).toBe("src/a.ts");
    } finally {
      view.unmount();
    }
    // This test loads the rich Markdown renderer for the task asset.
  }, 2_500);

  test("premium content forwards the policy", async () => {
    const open = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ChatFileLinkContext value={open}>
          <MarkdownRenderer
            markdown="[file](file:///repo/a.ts:42)"
            premiumCodeBlocks
            linkPolicy={CHAT_MARKDOWN_LINK_POLICY}
          />
        </ChatFileLinkContext>,
      );
    });
    try {
      fireEvent.click(view.getByRole("link"));
      expect(open.mock.calls.at(-1)?.[0]).toBe("file:///repo/a.ts:42");
    } finally {
      view.unmount();
    }
    // This test loads the premium Markdown renderer before it can open the link.
  }, 2_500);
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
  test("loads a file image through the host, and keeps scripts and non-chat file links out", async () => {
    const localImageRead = mock(async () => ({
      mediaType: "image/png" as const,
      bytesBase64: "AAAA",
    }));
    const view = renderView(
      <>
        <AgentChatMarkdownRenderer markdown="![image](file:///repo/a.png)\n\n<script>bad()</script>" />
        <MarkdownRenderer markdown="[file](file:///repo/a.ts)" />
      </>,
      {
        wrapper: ({ children }) => (
          <QueryProvider connection={createTestClientConnection({ client: { localImageRead } })}>
            <MermaidSvgCacheProvider>{children}</MermaidSvgCacheProvider>
          </QueryProvider>
        ),
      },
    );
    try {
      // The page never loads a `file:` URL itself. The host reads the image.
      await waitFor(() =>
        expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
          "data:image/png;base64,AAAA",
        ),
      );
      expect(localImageRead).toHaveBeenCalledWith({ path: "/repo/a.png" });
      expect(view.container.querySelector("script")).toBeNull();
      expect(view.container.querySelector("a")?.getAttribute("href")).toBe("");
    } finally {
      view.unmount();
    }
  });
});

test("external links keep shell behavior and unsafe schemes do not become file links", async () => {
  const openExternal = mock(async (_url: string) => {});
  const openFile = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
  const view = render(
    withShellPlatform(
      <ChatFileLinkContext value={openFile}>
        <AgentChatMarkdownRenderer markdown="[web](https://example.com) [unsafe](javascript:42) [file](a.ts:42) [empty]()" />
      </ChatFileLinkContext>,
      createShellBridgeFixture({ bridge: { openExternalUrl: openExternal } }),
    ),
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
  }
});

const [richRenderer, mathRenderer, mathCandidateRenderer, mermaidCandidateRenderer] =
  await Promise.all([
    import("@/components/ui/markdown-renderer-rich"),
    import("@/components/ui/markdown-renderer-math"),
    import("@/components/ui/markdown-renderer-math-candidate"),
    import("@/components/ui/markdown-renderer-mermaid-candidate"),
  ]);

for (const [rendererName, { default: Renderer }] of [
  ["rich", richRenderer],
  ["math", mathRenderer],
  ["math candidate", mathCandidateRenderer],
  ["Mermaid candidate", mermaidCandidateRenderer],
] as const) {
  // The rich renderer parses an asset image as well as the file link.
  const timeoutMs = rendererName === "rich" ? 2_500 : 1_000;
  test(
    `the final ${rendererName} renderer retains the file action`,
    async () => {
      const open = mock<(href: string, trigger: HTMLAnchorElement) => void>(() => {});
      await act(async () => {
        render(
          <ChatFileLinkContext value={open}>
            <Renderer
              markdown={
                "[file](file:///repo/a.ts:42)\n\n$x^2$\n\n```mermaid\ngraph TD; A-->B;\n```" +
                (rendererName === "rich" ? "\n\n![asset](odt-asset://example)" : "")
              }
              components={{ a: CHAT_MARKDOWN_LINK_POLICY.anchor }}
              linkPolicy={CHAT_MARKDOWN_LINK_POLICY}
              fallbackContent={<div>Loading</div>}
            />
          </ChatFileLinkContext>,
        );
      });
      const link = screen.getByRole("link", { name: "file" });
      fireEvent.click(link);
      expect(open).toHaveBeenCalledWith("file:///repo/a.ts:42", link);
    },
    timeoutMs,
  );
}
