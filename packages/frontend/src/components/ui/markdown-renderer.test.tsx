import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, type ReactNode, useLayoutEffect, useState } from "react";
import { toast } from "sonner";
import { ThemeProvider } from "@/components/layout/theme-provider";
import * as externalUrl from "@/lib/open-external-url";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { MarkdownMermaid } from "./markdown-mermaid";
import { MERMAID_RENDER_CONFIG } from "./markdown-mermaid-render";
import { MarkdownRenderer } from "./markdown-renderer";
import { MARKDOWN_COMPONENTS } from "./markdown-renderer-components";

const renderMarkdownLink = (href: string, label: string) => {
  const MarkdownLink = MARKDOWN_COMPONENTS.document.a;
  if (typeof MarkdownLink !== "function") {
    throw new Error("Expected the shared Markdown anchor to be a React component.");
  }
  return render(createElement(MarkdownLink, { href }, label));
};

const StaticThemeProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    queryClient.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture({ theme: "light" }),
    );
    setReady(true);
  }, [queryClient]);

  return ready ? <ThemeProvider>{children}</ThemeProvider> : null;
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

describe("rich task description rendering", () => {
  afterEach(() => {
    configureShellBridge(createUnavailableShellBridge());
  });

  test("omits preserved front matter and renders math through KaTeX", async () => {
    const view = render(
      <MarkdownRenderer
        markdown={"---\ntitle: Hidden\n---\nVisible $x^2$"}
        taskAssetContext={{
          workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
          taskId: "task-1",
          scope: "description",
        }}
      />,
    );

    await waitFor(() => expect(view.container.querySelector(".katex")).not.toBeNull(), {
      timeout: 3000,
    });
    expect(view.queryByText("title: Hidden", { exact: false })).toBeNull();
  }, 4000);

  test.each([
    ["spaces before LF and a following paragraph", "$$\nx\n$$   \n\nAfter"],
    ["a tab before CRLF and a following paragraph", "$$\r\nx\r\n$$\t\r\n\r\nAfter"],
    ["spaces at EOF", "$$\nx\n$$   "],
  ])(
    "renders block math with %s through KaTeX",
    async (_name, markdown) => {
      const view = render(<MarkdownRenderer markdown={markdown} />);

      await waitFor(() => expect(view.container.querySelector(".katex-display")).not.toBeNull(), {
        timeout: 3000,
      });
    },
    4000,
  );

  test.each([
    ["block math in a blockquote", "> $$\n> x\n> $$"],
    ["block math in a nested blockquote", "> > $$\n> > x\n> > $$"],
    ["inline math between unmatched backticks", "before `\n\n$x$\n\nafter `"],
  ])(
    "renders %s through KaTeX",
    async (_name, markdown) => {
      const view = render(<MarkdownRenderer markdown={markdown} />);

      await waitFor(() => expect(view.container.querySelector(".katex")).not.toBeNull(), {
        timeout: 3000,
      });
    },
    4000,
  );

  test.each([
    ["a bullet item", "- $$\n  x\n  $$"],
    ["an ordered item", "1. $$\n   x\n   $$"],
    ["a task item", "- [ ] $$\n  x\n  $$"],
  ])(
    "renders block math inside %s through KaTeX",
    async (_name, markdown) => {
      const view = render(<MarkdownRenderer markdown={markdown} />);

      await waitFor(
        () => expect(view.container.querySelector("li .katex-display")).not.toBeNull(),
        {
          timeout: 3000,
        },
      );
    },
    4000,
  );

  test.each([
    ["ordered prose before math", "1. Before\n\n   $$\n   x\n   $$", 1],
    ["task-item prose after math", "- [ ] $$\n  x\n  $$\n\n  After", 1],
    ["repeated bullet math", "- $$\n  x\n  $$\n\n  $$\n  y\n  $$", 2],
    [
      "repeated task-item math before prose",
      "- [ ] $$\n  x\n  $$\n\n  $$\n  y\n  $$\n\n  After **bold**",
      2,
    ],
  ])(
    "renders compound list math with %s",
    async (_name, markdown, expectedMathBlocks) => {
      const view = render(<MarkdownRenderer markdown={markdown} />);

      await waitFor(
        () =>
          expect(view.container.querySelectorAll("li .katex-display")).toHaveLength(
            expectedMathBlocks,
          ),
        { timeout: 3000 },
      );
      if (markdown.includes("After")) {
        expect(view.getByText("After")).toBeTruthy();
      }
    },
    4000,
  );

  test.each([
    ["four-tilde fences", "~~~~md\n$$\nx\n$$\n~~~~"],
    ["longer matching close fences", "~~~~md\n$$\nx\n$$\n~~~~~"],
    ["unmatched fences", "~~~~md\n$$\nx\n$$"],
  ])("keeps math lookalikes inside %s as code", async (_name, markdown) => {
    const view = render(<MarkdownRenderer markdown={markdown} />);

    await waitFor(() => {
      expect(view.container.querySelector("code")?.textContent).toContain("$$\nx\n$$");
    });
    expect(view.container.querySelector(".katex")).toBeNull();
  });

  test("omits valid front matter consistently with and without math or task context", async () => {
    const plain = render(
      <MarkdownRenderer markdown={"---\ntitle: Hidden plain\n---\nVisible plain"} />,
    );
    const math = render(
      <MarkdownRenderer markdown={"---\ntitle: Hidden math\n---\nVisible math $x$"} />,
    );

    expect(plain.getByText("Visible plain")).toBeTruthy();
    expect(plain.queryByText("title: Hidden plain", { exact: false })).toBeNull();
    await waitFor(() => expect(math.container.querySelector(".katex")).not.toBeNull(), {
      timeout: 3000,
    });
    expect(math.queryByText("title: Hidden math", { exact: false })).toBeNull();
  }, 4000);

  test("renders a plain contextual description without KaTeX output", async () => {
    const view = render(
      <MarkdownRenderer
        markdown="Plain task description"
        taskAssetContext={{
          workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
          taskId: "task-1",
          scope: "description",
        }}
      />,
    );

    expect(await view.findByText("Plain task description")).toBeTruthy();
    expect(view.container.querySelector(".katex")).toBeNull();
  });

  test("composes math, premium code, and task assets in one description render", async () => {
    const resolveTaskAssetSrc = mock(async () => "openducktor-task-asset://asset/resolved");
    configureShellBridge({
      ...createUnavailableShellBridge(),
      resolveTaskAssetSrc,
    });
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const view = render(
      <QueryProvider useIsolatedClient>
        <StaticThemeProvider>
          <MarkdownRenderer
            markdown={`Formula $x^2$\n\n\`\`\`javascript\nconst answer = 42;\n\`\`\`\n\n![Diagram](odt-asset:${assetId})`}
            premiumCodeBlocks
            taskAssetContext={{
              workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
              taskId: "task-1",
              scope: "description",
            }}
          />
        </StaticThemeProvider>
      </QueryProvider>,
    );

    await waitFor(() => expect(view.container.querySelector(".katex")).not.toBeNull(), {
      timeout: 3000,
    });
    await waitFor(() => expect(view.container.querySelector(".token")).not.toBeNull(), {
      timeout: 3000,
    });
    await waitFor(
      () =>
        expect(view.getByRole("img", { name: "Diagram" }).getAttribute("src")).toBe(
          "openducktor-task-asset://asset/resolved",
        ),
      { timeout: 3000 },
    );
  }, 5000);

  test("keeps premium code rendering for task documents that also contain math", async () => {
    const view = render(
      <QueryProvider useIsolatedClient>
        <StaticThemeProvider>
          <MarkdownRenderer
            markdown={"Formula $x$\n\n```javascript\nconst value = 1;\n```"}
            premiumCodeBlocks
          />
        </StaticThemeProvider>
      </QueryProvider>,
    );

    await waitFor(() => expect(view.container.querySelector(".katex")).not.toBeNull(), {
      timeout: 3000,
    });
    await waitFor(() => expect(view.container.querySelector(".token")).not.toBeNull(), {
      timeout: 3000,
    });
  }, 5000);

  test("resolves logical task assets through the shell without persisting runtime URLs", async () => {
    const resolveTaskAssetSrc = mock(async () => "openducktor-task-asset://asset/resolved");
    configureShellBridge({
      ...createUnavailableShellBridge(),
      resolveTaskAssetSrc,
    });
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const view = render(
      <MarkdownRenderer
        markdown={`![Architecture](odt-asset:${assetId} "Diagram")`}
        taskAssetContext={{
          workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
          taskId: "task-1",
          scope: "description",
        }}
      />,
    );

    await waitFor(
      () =>
        expect(view.getByRole("img", { name: "Architecture" }).getAttribute("src")).toBe(
          "openducktor-task-asset://asset/resolved",
        ),
      { timeout: 3000 },
    );
    expect(resolveTaskAssetSrc).toHaveBeenCalledWith({
      workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
      taskId: "task-1",
      scope: "description",
      assetId,
    });
  }, 4000);

  test("resolves the first definition when an image reference identifier is duplicated", async () => {
    const resolveTaskAssetSrc = mock(async () => "openducktor-task-asset://asset/resolved");
    configureShellBridge({
      ...createUnavailableShellBridge(),
      resolveTaskAssetSrc,
    });
    const first = "550e8400-e29b-41d4-a716-446655440000";
    const second = "750e8400-e29b-41d4-a716-446655440001";
    const markdown = [
      "![Architecture][diagram]",
      "",
      `[diagram]: odt-asset:${first}`,
      `[diagram]: odt-asset:${second}`,
    ].join("\n");
    const view = render(
      <MarkdownRenderer
        markdown={markdown}
        taskAssetContext={{
          workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
          taskId: "task-1",
          scope: "description",
        }}
      />,
    );

    await waitFor(
      () =>
        expect(view.getByRole("img", { name: "Architecture" }).getAttribute("src")).toBe(
          "openducktor-task-asset://asset/resolved",
        ),
      { timeout: 3000 },
    );
    expect(resolveTaskAssetSrc).toHaveBeenCalledTimes(1);
    expect(resolveTaskAssetSrc).toHaveBeenCalledWith({
      workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
      taskId: "task-1",
      scope: "description",
      assetId: first,
    });
  }, 4000);

  test("does not request a logical task asset without task context", async () => {
    const resolveTaskAssetSrc = mock(async () => "openducktor-task-asset://asset/resolved");
    configureShellBridge({
      ...createUnavailableShellBridge(),
      resolveTaskAssetSrc,
    });
    const view = render(
      <MarkdownRenderer markdown="![Architecture](odt-asset:550e8400-e29b-41d4-a716-446655440000)" />,
    );

    expect(view.getByRole("alert").textContent).toContain("task context is unavailable");
    expect(view.queryByRole("img", { name: "Architecture" })).toBeNull();
    expect(resolveTaskAssetSrc).not.toHaveBeenCalled();
  });

  test("does not resolve a forged logical asset ID", async () => {
    const resolveTaskAssetSrc = mock(async () => "openducktor-task-asset://asset/resolved");
    configureShellBridge({
      ...createUnavailableShellBridge(),
      resolveTaskAssetSrc,
    });
    const view = render(
      <MarkdownRenderer
        markdown="![Forged](odt-asset:550e8400e29b-41d4-a716-446655440000-)"
        taskAssetContext={{
          workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
          taskId: "task-1",
          scope: "description",
        }}
      />,
    );

    expect(view.getByRole("alert").textContent).toContain("task asset reference is invalid");
    expect(view.queryByRole("img", { name: "Forged" })).toBeNull();
    expect(resolveTaskAssetSrc).not.toHaveBeenCalled();
  });

  test("renders a Mermaid diagram without exposing its source and suppresses raw HTML", async () => {
    const view = render(
      <MarkdownRenderer
        markdown={"```mermaid\ngraph TD\n A --> B\n```\n<script>alert(1)</script>"}
        taskAssetContext={{
          workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
          taskId: "task-1",
          scope: "description",
        }}
      />,
    );

    await waitFor(() => expect(view.container.querySelector("svg")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(view.queryByText("Mermaid source")).toBeNull();
    expect(view.queryByText(/graph TD/)).toBeNull();
    expect(view.container.querySelector("script")).toBeNull();
  }, 4000);

  test("uses sanitizer-safe SVG text for Mermaid labels", () => {
    expect(MERMAID_RENDER_CONFIG).toMatchObject({
      securityLevel: "strict",
      htmlLabels: false,
    });
  });

  test("mounts a stable Mermaid viewport before the first preview is ready", async () => {
    const renderModule = await import("./markdown-mermaid-render");
    let resolveRender: ((svg: string) => void) | undefined;
    const renderSpy = spyOn(renderModule, "renderMermaidSvg").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRender = resolve;
        }),
    );

    try {
      const view = render(<MarkdownMermaid source={"graph TD\n  A --> B"} />);

      const viewport = view.getByRole("region", { name: "Mermaid diagram" });
      expect(view.queryByText(/graph TD/)).toBeNull();
      expect(viewport.getAttribute("aria-busy")).toBe("true");

      resolveRender?.(
        '<svg xmlns="http://www.w3.org/2000/svg"><text>Rendered diagram</text></svg>',
      );
      await waitFor(() => expect(view.getByText("Rendered diagram")).toBeTruthy(), {
        timeout: 3000,
      });
      expect(view.getByRole("region", { name: "Mermaid diagram" })).toBe(viewport);
      expect(viewport.getAttribute("aria-busy")).toBe("false");
    } finally {
      renderSpy.mockRestore();
    }
  }, 4000);

  test("keeps surrounding Markdown mounted while its Mermaid preview renders", async () => {
    const renderModule = await import("./markdown-mermaid-render");
    let resolveRender: ((svg: string) => void) | undefined;
    const renderSpy = spyOn(renderModule, "renderMermaidSvg").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRender = resolve;
        }),
    );

    try {
      const view = render(
        <MarkdownRenderer markdown={"Before\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nAfter"} />,
      );

      await waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1), {
        timeout: 3000,
      });
      expect(view.getByText("Before")).toBeTruthy();
      expect(view.getByText("After")).toBeTruthy();
      const viewport = view.getByRole("region", { name: "Mermaid diagram" });
      expect(view.container.querySelector("svg")).toBeNull();

      resolveRender?.(
        '<svg xmlns="http://www.w3.org/2000/svg"><text>Rendered diagram</text></svg>',
      );
      await waitFor(() => expect(view.getByText("Rendered diagram")).toBeTruthy(), {
        timeout: 3000,
      });
      expect(view.getByRole("region", { name: "Mermaid diagram" })).toBe(viewport);
    } finally {
      renderSpy.mockRestore();
    }
  }, 4000);

  test("commits math and Mermaid through the same prepared render", async () => {
    const view = render(
      <MarkdownRenderer markdown={"Before $x$\n\n```mermaid\ngraph TD\n  A --> B\n```"} />,
    );

    await waitFor(() => expect(view.container.querySelector("svg")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(view.container.querySelector(".katex")).not.toBeNull();
    expect(view.getByText("Before")).toBeTruthy();
  }, 4000);

  test("keeps the current Mermaid preview visible while an editor update settles", async () => {
    const renderModule = await import("./markdown-mermaid-render");
    const renderSpy = spyOn(renderModule, "renderMermaidSvg").mockImplementation(
      async (_id, source) =>
        `<svg xmlns="http://www.w3.org/2000/svg"><text>${source.endsWith("C") ? "C" : "B"}</text></svg>`,
    );

    try {
      const view = render(<MarkdownMermaid source={"graph TD\n  A --> B"} />);

      await waitFor(() => expect(view.queryByText("Rendering diagram…")).toBeNull(), {
        timeout: 3000,
      });
      const currentPreview = view.container.innerHTML;

      view.rerender(<MarkdownMermaid source={"graph TD\n  A --> C"} renderDelayMs={100} />);

      expect(view.queryByText("Rendering diagram…")).toBeNull();
      expect(view.container.innerHTML).toBe(currentPreview);
      await waitFor(() => expect(view.container.innerHTML).not.toBe(currentPreview), {
        timeout: 3000,
      });
    } finally {
      renderSpy.mockRestore();
    }
  }, 4000);

  test("shows an actionable Mermaid parse error without exposing its source", async () => {
    const view = render(
      <MarkdownRenderer
        markdown={"```mermaid\nthis is not a diagram\n```"}
        taskAssetContext={{
          workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
          taskId: "task-1",
          scope: "description",
        }}
      />,
    );

    expect(await view.findByText("Diagram preview failed", {}, { timeout: 3000 })).toBeTruthy();
    expect(view.queryByText("Mermaid source")).toBeNull();
    expect(view.queryByText("this is not a diagram")).toBeNull();
    expect(view.getByText(/Edit the Mermaid source/)).toBeTruthy();
  }, 4000);

  test.each([
    ["four backticks", "````mermaid\ngraph TD\n  A --> B\n````"],
    ["four tildes", "~~~~mermaid\ngraph TD\n  A --> B\n~~~~"],
    ["a longer closing fence", "````mermaid\ngraph TD\n  A --> B\n`````"],
    ["allowed indentation and whitespace", "   ````  mermaid  \ngraph TD\n  A --> B\n   ````"],
  ])(
    "renders Mermaid fenced with %s",
    async (_name, markdown) => {
      const view = render(<MarkdownRenderer markdown={markdown} />);

      await waitFor(() => expect(view.container.querySelector("svg")).toBeTruthy(), {
        timeout: 3000,
      });
      expect(view.queryByText("Mermaid source")).toBeNull();
      expect(view.queryByText(/graph TD/)).toBeNull();
    },
    4000,
  );

  test("shows an actionable error for invalid Mermaid in a long fence", async () => {
    const view = render(<MarkdownRenderer markdown={"````mermaid\nthis is not a diagram\n````"} />);

    expect(await view.findByText("Diagram preview failed", {}, { timeout: 3000 })).toBeTruthy();
    expect(view.queryByText("Mermaid source")).toBeNull();
    expect(view.queryByText("this is not a diagram")).toBeNull();
  }, 4000);

  test.each([
    ["a blockquote", "> ```mermaid\n> graph TD\n>   A --> B\n> ```"],
    ["a nested blockquote", "> > ```mermaid\n> > graph TD\n> >   A --> B\n> > ```"],
  ])(
    "renders Mermaid inside %s",
    async (_name, markdown) => {
      const view = render(<MarkdownRenderer markdown={markdown} />);

      await waitFor(() => expect(view.container.querySelector("svg")).toBeTruthy(), {
        timeout: 3000,
      });
      expect(view.queryByText("Mermaid source")).toBeNull();
      expect(view.queryByText(/graph TD/)).toBeNull();
    },
    4000,
  );

  test("shows an actionable error for invalid Mermaid inside a nested blockquote", async () => {
    const view = render(
      <MarkdownRenderer markdown={"> > ```mermaid\n> > this is not a diagram\n> > ```"} />,
    );

    expect(await view.findByText("Diagram preview failed", {}, { timeout: 3000 })).toBeTruthy();
    expect(view.queryByText("Mermaid source")).toBeNull();
    expect(view.queryByText("this is not a diagram")).toBeNull();
    expect(view.getByText(/Edit the Mermaid source/)).toBeTruthy();
  }, 4000);
});
