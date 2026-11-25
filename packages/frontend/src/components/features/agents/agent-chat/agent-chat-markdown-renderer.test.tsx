import { createShellBridgeFixture, withShellPlatform } from "@/test-utils/focused-fixture";
import { describe, expect, mock, spyOn, test } from "bun:test";
import { fireEvent, render as renderView, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { toast } from "sonner";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { ChatFileLinkContext } from "./agent-chat-file-link-context";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";
import { loadMarkdownModules } from "@/test-utils/markdown-modules";

await loadMarkdownModules();

const render = (element: ReactElement) => renderView(element, { wrapper: QueryProvider });

const chat = (markdown: string, streaming = false): ReactElement => (
  <AgentChatMarkdownRenderer markdown={markdown} streaming={streaming} />
);

type OpenFile = (href: string, trigger: HTMLAnchorElement) => void;

const withFiles = (open: OpenFile, children: ReactNode): ReactElement => (
  <ChatFileLinkContext value={open}>{children}</ChatFileLinkContext>
);

describe("AgentChatMarkdownRenderer", () => {
  test("renders a completed reply in its first frame", () => {
    const view = render(chat("Persisted the **canonical spec**.\n\n- First\n- Second"));

    expect(view.container.querySelector(".markdown-body strong")?.textContent).toBe(
      "canonical spec",
    );
    expect(view.container.querySelectorAll("li")).toHaveLength(2);
  });

  test("renders a streamed reply as the same reply rendered at once", () => {
    const reply = [
      "## Result",
      "",
      "- one\n- two\n\n  Continuation.\n- three",
      "",
      "| File | Change |\n| --- | --- |\n| `a.ts` | **added** |",
      "",
      "```ts\nconst value = 1;\n```",
      "",
      "Done[^1].\n\n[^1]: A note.",
    ].join("\n");
    const fresh = render(chat(reply));
    const streamed = render(chat(reply.slice(0, 5), true));

    for (let end = 10; end < reply.length; end += 7) {
      streamed.rerender(chat(reply.slice(0, end), true));
    }
    streamed.rerender(chat(reply));

    // The highlighter can write the styles of a token in another form, so compare code as text.
    const renderedReply = (view: ReturnType<typeof render>) => ({
      elements: Array.from(view.container.querySelectorAll("*"))
        .filter((element) => !element.closest("code"))
        .map((element) => element.tagName),
      text: view.container.textContent,
    });
    expect(renderedReply(streamed)).toEqual(renderedReply(fresh));
  });

  test("keeps one root element while the reply streams", () => {
    const view = render(chat("Plain line", true));
    const root = view.container.firstElementChild;

    view.rerender(chat("Plain line with **emphasis**", true));

    expect(view.container.firstElementChild).toBe(root);
    expect(view.container.querySelector("strong")?.textContent).toBe("emphasis");
  });

  test("shows an open code fence as code while the reply streams", () => {
    const view = render(chat("```ts\nconst value = 1;", true));

    expect(view.container.querySelector("pre code")?.textContent).toContain("const value = 1;");
  });

  test("keeps raw HTML out of the reply", () => {
    const view = render(chat("<script>alert('bad')</script>\n\n**safe**"));

    expect(view.container.querySelector("script")).toBeNull();
    expect(view.getByText("safe")).toBeTruthy();
  });

  test("keeps a drawn diagram while the reply streams and ends", async () => {
    const diagram = "Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```";
    const view = render(chat(`${diagram}\n\nAfter`, true));
    await waitFor(() => expect(view.container.querySelector("svg.pele")).not.toBeNull());
    const svg = view.container.querySelector("svg.pele");

    view.rerender(chat(`${diagram}\n\nAfter the diagram.`, true));
    view.rerender(chat(`${diagram}\n\nAfter the diagram.`));

    expect(view.getByText("After the diagram.")).toBeTruthy();
    expect(view.container.querySelector("svg.pele")).toBe(svg);
  });

  test("shows images of host files through the host, and web images as they are", async () => {
    const localImageRead = mock(async ({ path }: { path: string }) => ({
      mediaType: "image/png" as const,
      bytesBase64: path === "/tmp/shot.png" ? "AAAA" : "BBBB",
    }));
    const view = renderView(
      chat("![Shot](/tmp/shot.png) ![File](file:///tmp/a%20b.png) ![Web](https://x.dev/a.png)"),
      {
        wrapper: ({ children }) => (
          <QueryProvider connection={createTestClientConnection({ client: { localImageRead } })}>
            {children}
          </QueryProvider>
        ),
      },
    );

    await waitFor(() =>
      expect(view.getByRole("img", { name: "Shot" }).getAttribute("src")).toBe(
        "data:image/png;base64,AAAA",
      ),
    );
    expect(view.getByRole("img", { name: "File" }).getAttribute("src")).toBe(
      "data:image/png;base64,BBBB",
    );
    expect(view.getByRole("img", { name: "Web" }).getAttribute("src")).toBe("https://x.dev/a.png");
    expect(localImageRead.mock.calls.map(([input]) => input.path).sort()).toEqual([
      "/tmp/a b.png",
      "/tmp/shot.png",
    ]);
  });
});

describe("chat file links", () => {
  test.each([
    "[file](src/a.ts:42)",
    "[`file`](file:///repo/a.ts#L42)",
    "[file][source]\n\n[source]: <src/a b.ts>",
    "[file](src/%E6%96%87.ts)\n\n$x^2$",
    "[file](src/a.ts)\n\n```mermaid\ngraph TD; A-->B;\n```",
  ])("opens %s once per activation", (markdown) => {
    const open = mock<OpenFile>(() => {});
    const view = render(withFiles(open, chat(markdown)));
    const link = view.getByRole("link", { name: "file" });

    expect(link.getAttribute("href")).toBe("#");
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
      fireEvent.click(link, { [modifier]: true });
    }
    const middle = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    expect(fireEvent(link, middle)).toBe(false);
    expect(open).not.toHaveBeenCalled();

    expect(fireEvent.click(link)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
    fireEvent.keyDown(link, { key: "Enter", repeat: true });
    expect(open).toHaveBeenCalledTimes(2);
  });

  test("opens a streamed link only once it is complete", () => {
    const open = mock<OpenFile>(() => {});
    const view = render(withFiles(open, chat("[file](src/a", true)));

    expect(view.queryByRole("link")).toBeNull();
    view.rerender(withFiles(open, chat("[file](src/a.ts)", true)));
    fireEvent.click(view.getByRole("link", { name: "file" }));

    expect(open.mock.calls.at(-1)?.[0]).toBe("src/a.ts");
  });

  test("keeps web links on the shell, drops unsafe schemes, and opens file links", () => {
    const openExternal = mock(async (_url: string) => {});
    const openFile = mock<OpenFile>(() => {});
    const view = render(
      withShellPlatform(
        withFiles(
          openFile,
          chat("[web](https://example.com) [unsafe](javascript:42) [file](a.ts:42) [empty]()"),
        ),
        createShellBridgeFixture({ bridge: { openExternalUrl: openExternal } }),
      ),
    );

    fireEvent.click(view.getByText("web"));
    fireEvent.click(view.getByText("unsafe"));
    fireEvent.click(view.getByText("file"));
    fireEvent.click(view.getByText("empty"));

    expect(openExternal.mock.calls).toEqual([["https://example.com"]]);
    expect(openFile.mock.calls.map(([href]) => href)).toEqual(["a.ts:42", ""]);
  });

  test("says why a file link cannot open without a worktree", () => {
    const toastError = spyOn(toast, "error").mockImplementation(() => "toast-id");
    try {
      const view = render(chat("[file](src/a.ts)"));
      fireEvent.click(view.getByRole("link", { name: "file" }));

      expect(toastError).toHaveBeenCalledWith("Cannot open file: src/a.ts", {
        description: "The Task's Build Worktree is unavailable.",
      });
    } finally {
      toastError.mockRestore();
    }
  });
});
