import { withShellPlatform } from "@/test-utils/focused-fixture";
import { IsolatedMarkdownWrapper } from "@/test-utils/isolated-markdown-wrapper";
import { describe, expect, mock, spyOn, test } from "bun:test";
import { fireEvent, render as renderView, waitFor, within } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { toast } from "sonner";
import { createUnavailableShellBridge } from "@/lib/shell-bridge";
import { MarkdownMermaid } from "./markdown-mermaid";
import { MarkdownPreviewModal } from "./markdown-preview-modal";
import { MarkdownRenderer } from "./markdown-renderer";
import { MarkdownStreamRenderer } from "./markdown-stream-renderer";
import { loadMarkdownModules } from "@/test-utils/markdown-modules";

await loadMarkdownModules();

const render = (element: ReactNode) => renderView(element, { wrapper: IsolatedMarkdownWrapper });

const TASK_ASSET_CONTEXT = {
  workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
  taskId: "task-1",
  scope: "description" as const,
};
const ASSET_ID = "550e8400-e29b-41d4-a716-446655440000";

const renderLink = (markdown: string, openExternalUrl: (url: string) => Promise<void>) =>
  render(
    withShellPlatform(<MarkdownRenderer markdown={markdown} />, {
      ...createUnavailableShellBridge(),
      openExternalUrl,
    }),
  );

describe("links", () => {
  test("opens a web link through the external URL bridge", () => {
    const openExternalUrl = mock(async (_url: string) => {});
    const view = renderLink("[Open docs](https://example.com/docs)", openExternalUrl);
    const link = view.getByRole("link", { name: "Open docs" });

    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(fireEvent.click(link)).toBe(false);
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  test("opens the link of a linked host image through the external URL bridge", async () => {
    const openExternalUrl = mock(async (_url: string) => {});
    const view = renderLink(
      `[![Shot](odt-asset:${ASSET_ID})](https://example.com/shot)`,
      openExternalUrl,
    );
    const image = await view.findByRole("alert");

    expect(fireEvent.click(image)).toBe(false);
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/shot");
  });

  test("opens a web link on middle click, and blocks other buttons and the context menu", () => {
    const openExternalUrl = mock(async (_url: string) => {});
    const view = renderLink("[Open link](https://example.com/middle)", openExternalUrl);
    const link = view.getByRole("link", { name: "Open link" });

    const right = new MouseEvent("auxclick", { bubbles: true, button: 2, cancelable: true });
    expect(fireEvent(link, right)).toBe(false);
    expect(fireEvent.contextMenu(link)).toBe(false);
    expect(openExternalUrl).not.toHaveBeenCalled();

    const middle = new MouseEvent("auxclick", { bubbles: true, button: 1, cancelable: true });
    expect(fireEvent(link, middle)).toBe(false);
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/middle");
  });

  test("shows an actionable error when the shell rejects a link", async () => {
    const openExternalUrl = mock(async (_url: string) => {
      throw new Error("Shell rejected the URL");
    });
    const toastError = spyOn(toast, "error").mockImplementation(() => "toast-id");
    try {
      const view = renderLink("[Open link](https://example.com/rejected)", openExternalUrl);
      fireEvent.click(view.getByRole("link", { name: "Open link" }));
      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith("Failed to open link", {
          description: "Shell rejected the URL",
        }),
      );
    } finally {
      toastError.mockRestore();
    }
  });

  test("drops a link with an unsafe scheme, keeps its text, and opens nothing", () => {
    const openExternalUrl = mock(async (_url: string) => {});
    const view = renderLink("[Run](javascript:alert(1))", openExternalUrl);

    expect(view.queryByRole("link")).toBeNull();
    fireEvent.click(view.getByText("Run"));
    const middle = new MouseEvent("auxclick", { bubbles: true, button: 1, cancelable: true });
    fireEvent(view.getByText("Run"), middle);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  test("shows links as text in a text-links preview", () => {
    const view = render(
      <MarkdownRenderer markdown="See [the docs](https://example.com)." links="text" />,
    );

    expect(view.queryByRole("link")).toBeNull();
    expect(view.getByText("the docs")).toBeTruthy();
  });

  test("opens a local link with the caller action, never through navigation", () => {
    const open = mock((_destination: string, _anchor: HTMLAnchorElement) => {});
    const local = { handles: (href: string) => href.startsWith("src/"), open };
    const view = render(
      <MarkdownStreamRenderer
        markdown="Read [the file](src/a.ts:42)."
        streaming={false}
        links={{ local }}
      />,
    );
    const link = view.getByRole("link", { name: "the file" });

    expect(link.getAttribute("href")).toBe("#");
    expect(link.getAttribute("title")).toBe("src/a.ts:42");
    fireEvent.click(link, { metaKey: true });
    expect(open).not.toHaveBeenCalled();
    expect(fireEvent.click(link)).toBe(false);
    expect(open).toHaveBeenCalledWith("src/a.ts:42", link);
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
    fireEvent.keyDown(link, { key: "Enter", repeat: true });
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe("forged marks", () => {
  test.each([
    ["an image", "Hello ![x](#odt-image:%E0%A4%A) end"],
    ["a link", "See [x](#odt-link:%) end"],
  ])("ignores %s with a forged mark of the view", (_name, markdown) => {
    const local = { handles: () => true, open: mock(() => {}) };
    const view = render(
      <MarkdownStreamRenderer markdown={markdown} streaming={false} links={{ local }} />,
    );

    expect(view.container.textContent).toContain("end");
    expect(view.container.querySelector("img, [data-words-island], [data-local-link]")).toBeNull();
  });
});

test("shows an image island directive in the text as text", () => {
  const markdown = `Hello :odt-image[x]{src="odt-asset:${ASSET_ID}"} end`;
  const view = render(
    withShellPlatform(<MarkdownRenderer markdown={markdown} />, createUnavailableShellBridge()),
  );

  expect(view.container.textContent).toContain(":odt-image[x]");
  expect(view.container.querySelector("[data-words-island]")).toBeNull();
});

describe("every Markdown form of a hooked element", () => {
  test.each([
    ["an alt text with brackets", `![shot \\[v2\\]](odt-asset:${ASSET_ID})`],
    ["an alt text on two lines", `![one\ntwo](odt-asset:${ASSET_ID})`],
    ["a reference image", `![ref]\n\n[ref]: odt-asset:${ASSET_ID}`],
  ])("loads a task asset from %s", async (_name, markdown) => {
    const view = render(
      withShellPlatform(<MarkdownRenderer markdown={markdown} />, createUnavailableShellBridge()),
    );

    expect((await view.findByRole("alert")).textContent).toBe(
      "Image could not be loaded: task context is unavailable.",
    );
  });

  test("shows a task item in a quote as an app checkbox", () => {
    const view = render(<MarkdownRenderer markdown="> - [x] done" />);

    expect(view.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    expect(view.container.querySelector("input")).toBeNull();
  });

  test("opens a local file autolink with the caller action", () => {
    const open = mock((_destination: string, _anchor: HTMLAnchorElement) => {});
    const local = { handles: (href: string) => href.startsWith("file:"), open };
    const view = render(
      <MarkdownStreamRenderer
        markdown="See <file:///repo/a.ts>."
        streaming={false}
        links={{ local }}
      />,
    );

    fireEvent.click(view.getByRole("link"));
    expect(open).toHaveBeenCalledWith("file:///repo/a.ts", expect.anything());
  });

  test.each([
    ["a list item", "- Step\n\n  ```mermaid\n  flowchart LR\n    A --> B\n  ```"],
    ["a quote", "> ```mermaid\n> flowchart LR\n>   A --> B\n> ```"],
  ])("draws a Mermaid fence in %s", async (_name, markdown) => {
    const view = render(<MarkdownRenderer markdown={markdown} />);

    await waitFor(() => expect(view.container.querySelector("svg.pele")).not.toBeNull());
  });
});

describe("document content", () => {
  test("shows each GFM task item as a read-only app checkbox with its state", () => {
    const view = render(<MarkdownRenderer markdown={"- [x] Typing works\n- [ ] Sorting works"} />);
    const boxes = view.getAllByRole("checkbox");

    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(boxes.every((box) => box.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(view.container.querySelector("input")).toBeNull();
  });

  test("omits valid front matter and keeps thematic breaks", () => {
    const view = render(
      <MarkdownRenderer
        markdown={"---\ntitle: Hidden\n---\nVisible\n\n---\n\nAfter"}
        stripTaskDescriptionFrontMatter
      />,
    );

    expect(view.queryByText("title: Hidden", { exact: false })).toBeNull();
    expect(view.getByText("Visible")).toBeTruthy();
    expect(view.container.querySelectorAll("hr")).toHaveLength(1);
  });

  test("draws math, and keeps prices and code as text", () => {
    const view = render(
      <MarkdownRenderer
        markdown={"Euler $e^{i\\pi}+1=0$.\n\nRates ($0.25 / $2 per million).\n\n`$x$`"}
      />,
    );

    expect(view.container.querySelectorAll('[data-markdown="math"]')).toHaveLength(1);
    expect(view.getByText("Rates ($0.25 / $2 per million).")).toBeTruthy();
    expect(view.getByText("$x$")).toBeTruthy();
  });

  test("keeps math as text in a lightweight preview", () => {
    const view = render(<MarkdownRenderer markdown="Euler $e^x$." lightweight />);

    expect(view.container.querySelector('[data-markdown="math"]')).toBeNull();
    expect(view.getByText("Euler $e^x$.")).toBeTruthy();
  });

  test("highlights fenced code in the Pierre themes", async () => {
    const view = render(<MarkdownRenderer markdown={"```ts\nconst value = 1;\n```"} />);

    await waitFor(() =>
      expect(view.container.querySelector('code span[style*="light-dark("]')).not.toBeNull(),
    );
    expect(view.container.querySelector("code")?.textContent).toBe("const value = 1;\n");
  });

  test("shows an image as a chip in a label preview", () => {
    const view = render(
      <MarkdownRenderer markdown="![Shot](https://x.dev/a.png)" images="label" />,
    );

    expect(view.queryByRole("img")).toBeNull();
    expect(view.getByText("Shot")).toBeTruthy();
  });
});

describe("host images", () => {
  test("resolves a task asset through the shell without keeping its runtime URL", async () => {
    const resolveTaskAssetSource = mock(async () => ({
      kind: "url" as const,
      src: "openducktor-task-asset://asset/resolved",
    }));
    const view = render(
      withShellPlatform(
        <MarkdownRenderer
          markdown={`Before ![Architecture](odt-asset:${ASSET_ID} "Diagram") after`}
          taskAssetContext={TASK_ASSET_CONTEXT}
        />,
        { ...createUnavailableShellBridge(), resolveTaskAssetSource },
      ),
    );

    const image = await view.findByRole("img", { name: "Architecture" });
    expect(image.getAttribute("src")).toBe("openducktor-task-asset://asset/resolved");
    expect(image.getAttribute("title")).toBe("Diagram");
    expect(resolveTaskAssetSource).toHaveBeenCalledWith(
      { ...TASK_ASSET_CONTEXT, assetId: ASSET_ID },
      expect.any(AbortSignal),
    );
  });

  test("shows an actionable error when a resolved task asset cannot load", async () => {
    const view = render(
      withShellPlatform(
        <MarkdownRenderer
          markdown={`![Architecture](odt-asset:${ASSET_ID})`}
          taskAssetContext={TASK_ASSET_CONTEXT}
        />,
        {
          ...createUnavailableShellBridge(),
          resolveTaskAssetSource: async () => ({
            kind: "url" as const,
            src: "openducktor-task-asset://asset/missing",
          }),
        },
      ),
    );

    fireEvent.error(await view.findByRole("img", { name: "Architecture" }));

    expect((await view.findByRole("alert")).textContent).toBe(
      "Image could not be loaded: The task asset response failed to load.",
    );
  });

  test.each([
    ["without task context", `![A](odt-asset:${ASSET_ID})`, "task context is unavailable."],
    ["with a forged ID", "![A](odt-asset:not-an-id)", "the task asset reference is invalid."],
  ])("explains a task asset %s and requests nothing", async (_name, markdown, reason) => {
    const resolveTaskAssetSource = mock(async () => ({ kind: "url" as const, src: "x" }));
    const view = render(
      withShellPlatform(<MarkdownRenderer markdown={markdown} />, {
        ...createUnavailableShellBridge(),
        resolveTaskAssetSource,
      }),
    );

    expect((await view.findByRole("alert")).textContent).toBe(
      `Image could not be loaded: ${reason}`,
    );
    expect(resolveTaskAssetSource).not.toHaveBeenCalled();
  });

  test("shows each copy of the same image", async () => {
    const view = render(
      withShellPlatform(
        <MarkdownRenderer
          markdown={`![A](odt-asset:${ASSET_ID})\n\n![A](odt-asset:${ASSET_ID})`}
          taskAssetContext={TASK_ASSET_CONTEXT}
        />,
        {
          ...createUnavailableShellBridge(),
          resolveTaskAssetSource: async () => ({ kind: "url" as const, src: "asset://a" }),
        },
      ),
    );

    await waitFor(() => expect(view.getAllByRole("img", { name: "A" })).toHaveLength(2));
  });

  test("loads a caller image source through its component", async () => {
    const view = render(
      <MarkdownRenderer
        markdown="![Bug](https://github.com/user-attachments/assets/1)"
        images={{
          handles: (src) => src.startsWith("https://github.com/user-attachments/"),
          Image: ({ alt }) => <span data-testid="caller-image">{alt}</span>,
        }}
      />,
    );

    expect((await view.findByTestId("caller-image")).textContent).toBe("Bug");
  });
});

describe("diagrams", () => {
  const FLOWCHART = "```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n```";

  // The app renders in StrictMode, which mounts each effect twice.
  test.each([
    ["the expand button", "button"],
    ["the diagram", "diagram"],
  ])("opens a drawn diagram in the preview dialog from %s", async (_name, target) => {
    const view = render(
      <StrictMode>
        <MarkdownRenderer markdown={`Intro\n\n${FLOWCHART}\n\nOutro`} />
      </StrictMode>,
    );

    await waitFor(() => expect(view.container.querySelector("svg.pele")).not.toBeNull());
    expect(view.container.querySelector('[data-markdown="code-block"]')).toBeNull();
    const diagram = view.container.querySelector("svg.pele");
    if (!diagram) throw new Error("The diagram is missing.");
    fireEvent.click(
      target === "button" ? view.getByRole("button", { name: "Open diagram preview" }) : diagram,
    );

    const dialog = await view.findByRole("dialog");
    expect(within(dialog).getByText("Diagram preview")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close diagram preview" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(view.getByText("Outro")).toBeTruthy();
  });

  test("shows the parse error and what to do for an invalid diagram", async () => {
    const view = render(<MarkdownRenderer markdown={"```mermaid\nflowchart LR\n  A -->\n```"} />);

    const alert = await view.findByRole("alert");
    expect(alert.textContent).toContain("Diagram preview failed");
    expect(alert.textContent).toContain("Edit the Mermaid source to fix the diagram.");
  });

  test("keeps a Mermaid fence as code in a lightweight preview", () => {
    const view = render(<MarkdownRenderer markdown={FLOWCHART} lightweight />);

    expect(view.container.querySelector("svg.pele")).toBeNull();
    expect(view.container.querySelector("code")?.textContent).toContain("flowchart LR");
  });

  test("gives each class box with members a name band, and none to a class without members", async () => {
    const view = render(
      <MarkdownRenderer
        markdown={
          "```mermaid\nclassDiagram\n  class Task {\n    +string id\n    +start() void\n  }\n  class Runtime\n  Task --> Runtime\n```"
        }
      />,
    );

    await waitFor(() => expect(view.container.querySelector("svg.pele")).not.toBeNull());
    const bandOf = (id: string) =>
      view.container.querySelector(`.pele-class[data-id="${id}"] .pele-node-header`);
    expect(bandOf("Task")).not.toBeNull();
    expect(bandOf("Runtime")).toBeNull();
  });

  test("draws a diagram outside a Markdown view", async () => {
    const view = render(<MarkdownMermaid source={"flowchart LR\n  A --> B"} />);

    await waitFor(() => expect(view.container.querySelector("svg.pele")).not.toBeNull());
    expect(view.getByRole("group", { name: "Mermaid diagram" })).toBeTruthy();
  });
});

describe("streaming", () => {
  test("renders a growing reply and its final form", () => {
    const view = render(<MarkdownStreamRenderer markdown="Hello **wor" streaming />);

    expect(view.container.querySelector("strong")?.textContent).toBe("wor");
    view.rerender(
      <MarkdownStreamRenderer markdown={"Hello **world**.\n\n- one\n- two"} streaming />,
    );
    view.rerender(
      <MarkdownStreamRenderer markdown={"Hello **world**.\n\n- one\n- two"} streaming={false} />,
    );

    expect(view.container.querySelector("strong")?.textContent).toBe("world");
    expect(view.getAllByRole("listitem")).toHaveLength(2);
  });
});

test("preview modal shows the document and its title", () => {
  const view = render(
    <MarkdownPreviewModal markdown="# Plan" open onOpenChange={() => {}} title="Spec" />,
  );

  expect(view.getByRole("heading", { name: "Plan" })).toBeTruthy();
  expect(view.getByText("Spec")).toBeTruthy();
});
