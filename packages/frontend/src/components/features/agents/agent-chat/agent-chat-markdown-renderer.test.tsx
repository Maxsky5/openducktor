import { describe, expect, spyOn, test } from "bun:test";
import { act, render as renderView, waitFor, within } from "@testing-library/react";
import type { Nodes } from "mdast";
import { createElement, type ReactElement } from "react";
import { MermaidSvgCacheProvider } from "@/components/ui/markdown-mermaid-svg-cache";
import * as markdownStreamTree from "@/components/ui/markdown-stream-tree";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";

const DIAGRAM_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Rendered diagram</text></svg>';
const DIAGRAM_FENCE = "```mermaid\ngraph TD\n  A --> B\n```";
const DIAGRAM_MARKDOWN = `Intro\n\n${DIAGRAM_FENCE}`;

// A block that keeps its content object does not render again, so only changed blocks render.
const spyOnBlockRenders = () => spyOn(markdownStreamTree, "renderMarkdownBlock");

const renderedTexts = (blockSpy: ReturnType<typeof spyOnBlockRenders>): string[] =>
  blockSpy.mock.calls.map(([content]) => content.nodes.map(nodeText).join(""));

const nodeText = (node: Nodes): string => {
  if ("value" in node) {
    return node.value;
  }
  if ("children" in node) {
    return node.children.map(nodeText).join("");
  }
  return "";
};

const spyOnDiagramRender = async (svg: Promise<string> = Promise.resolve(DIAGRAM_SVG)) => {
  const renderModule = await import("@/components/ui/markdown-mermaid-render");
  return spyOn(renderModule, "renderMermaidSvg").mockImplementation(() => svg);
};

const waitForDiagram = (container: HTMLElement) =>
  waitFor(() => expect(within(container).getByText("Rendered diagram")).toBeTruthy(), {
    timeout: 500,
  });

enableReactActEnvironment();

const render = (element: ReactElement) => renderView(element, { wrapper: MermaidSvgCacheProvider });

const chatMarkdown = (markdown: string, streaming = false): ReactElement =>
  createElement(AgentChatMarkdownRenderer, { markdown, streaming });

describe("AgentChatMarkdownRenderer", () => {
  test("renders completed markdown without a plain-text first frame", () => {
    const rendered = render(
      chatMarkdown(
        "Persisted the **canonical spec**.\n\n- First requirement\n- Second requirement",
      ),
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
    const rendered = render(chatMarkdown("```ts\nconst value = 1;", true));

    try {
      await waitFor(() => {
        expect(rendered.container.textContent).toContain("const value = 1;");
      });
    } finally {
      rendered.unmount();
    }
  });

  test("keeps raw html out of rendered chat markdown", async () => {
    const rendered = render(chatMarkdown("<script>alert('bad')</script>\n\n**safe**"));

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
    const rendered = render(chatMarkdown("```ts\nconst value = 1;\n```"));

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
    const rendered = render(chatMarkdown("Plain transcript line", true));

    try {
      const initialRoot = rendered.container.firstElementChild;
      expect(initialRoot?.classList.contains("markdown-body")).toBe(true);

      rendered.rerender(chatMarkdown("Plain transcript line with **emphasis**", true));

      expect(rendered.container.firstElementChild).toBe(initialRoot);
      expect(rendered.container.querySelector("strong")?.textContent).toBe("emphasis");
    } finally {
      rendered.unmount();
    }
  });

  test("renders only the changed block while a response streams", () => {
    const blockSpy = spyOnBlockRenders();
    const rendered = render(chatMarkdown("First paragraph.\n\nSecond paragraph.\n\nThird", true));

    try {
      blockSpy.mockClear();
      rendered.rerender(
        chatMarkdown("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.", true),
      );

      expect(renderedTexts(blockSpy)).toEqual(["Third paragraph."]);
      expect(rendered.container.querySelectorAll("p")).toHaveLength(3);
    } finally {
      rendered.unmount();
      blockSpy.mockRestore();
    }
  });

  test("keeps a finished diagram mounted while the response streams and ends", async () => {
    const diagramSpy = await spyOnDiagramRender();
    const rendered = render(chatMarkdown(`${DIAGRAM_MARKDOWN}\n\nAfter`, true));

    try {
      await waitForDiagram(rendered.container);
      const diagram = rendered.getByRole("region", { name: "Mermaid diagram" });

      rendered.rerender(chatMarkdown(`${DIAGRAM_MARKDOWN}\n\nAfter the diagram.`, true));
      rendered.rerender(chatMarkdown(`${DIAGRAM_MARKDOWN}\n\nAfter the diagram.`));

      expect(rendered.getByText("After the diagram.")).toBeTruthy();
      expect(rendered.getByRole("region", { name: "Mermaid diagram" })).toBe(diagram);
      expect(diagramSpy).toHaveBeenCalledTimes(1);
    } finally {
      rendered.unmount();
      diagramSpy.mockRestore();
    }
  });

  test.each([
    ["at the top level", "Intro\n\n```mermaid\ngraph TD\n  A -->", "  A --> B\n```", "  "],
    [
      "in a list item",
      "1. Draw it:\n\n   ```mermaid\n   graph TD\n   A -->",
      "   A --> B\n   ```",
      "",
    ],
  ])(
    "draws a streaming diagram %s once its fence closes",
    async (_, partialMarkdown, closingLines, sourceIndent) => {
      const diagramSpy = await spyOnDiagramRender();
      const completeMarkdown = `${partialMarkdown.slice(0, partialMarkdown.lastIndexOf("\n"))}\n${closingLines}`;
      const rendered = render(chatMarkdown(partialMarkdown, true));

      try {
        const diagram = await rendered.findByRole(
          "region",
          { name: "Mermaid diagram" },
          { timeout: 500 },
        );
        expect(diagram.getAttribute("aria-busy")).toBe("true");
        expect(diagramSpy).not.toHaveBeenCalled();

        rendered.rerender(chatMarkdown(completeMarkdown, true));

        await waitForDiagram(rendered.container);
        expect(rendered.getByRole("region", { name: "Mermaid diagram" })).toBe(diagram);
        expect(diagramSpy).toHaveBeenCalledTimes(1);
        expect(diagramSpy.mock.calls[0]?.[1]).toBe(`graph TD\n${sourceIndent}A --> B`);
      } finally {
        rendered.unmount();
        diagramSpy.mockRestore();
      }
    },
  );

  // A runtime can keep a reply streaming while it runs tools, so no more text comes for a while.
  test("draws a closed diagram at the end of a reply that still streams", async () => {
    const diagramSpy = await spyOnDiagramRender();
    const rendered = render(chatMarkdown(DIAGRAM_MARKDOWN, true));

    try {
      await waitForDiagram(rendered.container);
      expect(diagramSpy).toHaveBeenCalledTimes(1);
    } finally {
      rendered.unmount();
      diagramSpy.mockRestore();
    }
  });

  // A math block can load the KaTeX module first, which can take more than 1 s in a full test run.
  test("keeps a diagram after a display equation drawn while text streams", async () => {
    const diagramSpy = await spyOnDiagramRender();
    const equationAndDiagram = `$$\nx = 1\n\ny = 2\n$$\n\n${DIAGRAM_FENCE}`;
    const rendered = render(chatMarkdown(`${equationAndDiagram}\n\nAfter`, true));
    const blockSpy = spyOnBlockRenders();

    try {
      await waitForDiagram(rendered.container);
      // The equation renders again once the KaTeX module loads.
      await waitFor(
        () => expect(rendered.container.querySelector(".katex-display")).not.toBeNull(),
        {
          timeout: 3000,
        },
      );
      const diagram = rendered.getByRole("region", { name: "Mermaid diagram" });
      blockSpy.mockClear();

      rendered.rerender(chatMarkdown(`${equationAndDiagram}\n\nAfter the diagram.`, true));

      expect(renderedTexts(blockSpy)).toEqual(["After the diagram."]);
      expect(rendered.getByRole("region", { name: "Mermaid diagram" })).toBe(diagram);
      expect(diagramSpy).toHaveBeenCalledTimes(1);
    } finally {
      rendered.unmount();
      blockSpy.mockRestore();
      diagramSpy.mockRestore();
    }
  }, 4000);

  // A math block can load the KaTeX module first, which can take more than 1 s in a full test run.
  test("renders a changed math block once after KaTeX loads", async () => {
    const rendered = render(chatMarkdown("Intro\n\nValue $x$ and", true));
    const blockSpy = spyOnBlockRenders();

    try {
      await waitFor(() => expect(rendered.container.querySelector(".katex")).not.toBeNull(), {
        timeout: 3000,
      });
      blockSpy.mockClear();

      rendered.rerender(chatMarkdown("Intro\n\nValue $x$ and more", true));

      expect(renderedTexts(blockSpy)).toEqual(["Value x and more"]);
    } finally {
      rendered.unmount();
      blockSpy.mockRestore();
    }
  }, 4000);

  test("keeps a drawn diagram and resolves references when a link definition arrives", async () => {
    const diagramSpy = await spyOnDiagramRender();
    const reply = `${DIAGRAM_MARKDOWN}\n\nSee [the docs][docs].`;
    const rendered = render(chatMarkdown(reply, true));

    try {
      await waitForDiagram(rendered.container);
      const diagram = rendered.getByRole("region", { name: "Mermaid diagram" });
      const replyWithDefinition = `${reply}\n\n[docs]: https://example.com`;

      rendered.rerender(chatMarkdown(replyWithDefinition, true));
      rendered.rerender(chatMarkdown(replyWithDefinition));

      expect(rendered.container.querySelector("a")?.textContent).toBe("the docs");
      expect(rendered.getByRole("region", { name: "Mermaid diagram" })).toBe(diagram);
      expect(diagramSpy).toHaveBeenCalledTimes(1);
    } finally {
      rendered.unmount();
      diagramSpy.mockRestore();
    }
  });

  test("draws a diagram after footnotes while the reply streams and renders only the tail", async () => {
    const diagramSpy = await spyOnDiagramRender();
    const reply = `Text with a note[^1].\n\n[^1]: A note.\n\n${DIAGRAM_FENCE}\n\nAfter`;
    const rendered = render(chatMarkdown(reply, true));
    const blockSpy = spyOnBlockRenders();

    try {
      await waitForDiagram(rendered.container);
      const diagram = rendered.getByRole("region", { name: "Mermaid diagram" });
      blockSpy.mockClear();

      rendered.rerender(chatMarkdown(`${reply} the diagram.`, true));

      expect(renderedTexts(blockSpy)).toEqual(["After the diagram."]);
      expect(rendered.container.querySelector("sup a")?.textContent).toBe("1");
      expect(rendered.container.querySelector("section[data-footnotes]")?.textContent).toContain(
        "A note.",
      );
      expect(rendered.getByRole("region", { name: "Mermaid diagram" })).toBe(diagram);
      expect(diagramSpy).toHaveBeenCalledTimes(1);
    } finally {
      rendered.unmount();
      blockSpy.mockRestore();
      diagramSpy.mockRestore();
    }
  });

  test("renders a nested multiline link definition as in a completed reply", () => {
    const reply = '> [x]:\n>   https://example.com\n>   "A\n>   title"\n\nSee [x].';
    const streamed = render(chatMarkdown("> [x]:", true));
    const history = render(chatMarkdown(reply));

    try {
      streamed.rerender(chatMarkdown(reply, true));
      streamed.rerender(chatMarkdown(reply));

      const link = streamed.container.querySelector("a");
      expect(link?.textContent).toBe("x");
      expect(link?.getAttribute("title")).toBe("A\ntitle");
      const visibleText = (container: HTMLElement) =>
        container.textContent?.replace(/\s+/g, " ").trim();
      expect(visibleText(streamed.container)).toBe(visibleText(history.container));
      expect(streamed.container.textContent).not.toContain("example.com");
    } finally {
      streamed.unmount();
      history.unmount();
    }
  });

  // The list block parses again when it joins the next item. Its diagram must not draw again.
  test.each([
    ["after its render completes", true],
    ["while its render is pending", false],
  ])("draws a diagram once when its list joins the next item %s", async (_, drawFirst) => {
    const pendingSvg = Promise.withResolvers<string>();
    const diagramSpy = await spyOnDiagramRender(pendingSvg.promise);
    const list = "1. Draw it:\n\n   ```mermaid\n   graph TD\n   A --> B\n   ```";
    const rendered = render(chatMarkdown(`${list}\n2`, true));

    try {
      await waitFor(() => expect(diagramSpy).toHaveBeenCalledTimes(1), { timeout: 500 });
      const diagram = rendered.getByRole("region", { name: "Mermaid diagram" });
      if (drawFirst) {
        pendingSvg.resolve(DIAGRAM_SVG);
        await waitForDiagram(rendered.container);
      }

      for (const suffix of ["2. Next item", "2. Next item\n\nAfter"]) {
        rendered.rerender(chatMarkdown(`${list}\n${suffix}`, true));
      }
      await act(async () => {
        pendingSvg.resolve(DIAGRAM_SVG);
        await pendingSvg.promise;
      });

      expect(rendered.getByText("Rendered diagram")).toBeTruthy();
      expect(rendered.getByRole("region", { name: "Mermaid diagram" })).toBe(diagram);
      expect(diagramSpy).toHaveBeenCalledTimes(1);
    } finally {
      pendingSvg.resolve(DIAGRAM_SVG);
      rendered.unmount();
      diagramSpy.mockRestore();
    }
  });

  test("draws a diagram in a quoted footnote as in a completed reply", async () => {
    const diagramSpy = await spyOnDiagramRender();
    const reply =
      "Intro[^a].\n\n> [^a]:\n>     ```mermaid\n>     graph TD\n>     A --> B\n>     ```\n\nTail";
    const streamed = render(chatMarkdown(reply, true));
    const history = render(chatMarkdown(reply));

    try {
      await waitFor(
        () => expect(within(history.container).getByText("Rendered diagram")).toBeTruthy(),
        {
          timeout: 500,
        },
      );
      expect(
        within(streamed.container).getByRole("region", { name: "Mermaid diagram" }),
      ).toBeTruthy();

      streamed.rerender(chatMarkdown(reply));

      await waitForDiagram(streamed.container);
      expect(diagramSpy.mock.calls.map(([, source]) => source)).toEqual([
        "graph TD\nA --> B",
        "graph TD\nA --> B",
      ]);
    } finally {
      streamed.unmount();
      history.unmount();
      diagramSpy.mockRestore();
    }
  });

  // A math block can load the KaTeX module first, which can take more than 1 s in a full test run.
  test("renders task list math in a footnote as in a completed reply", async () => {
    const reply = "$z$\n\nIntro[^a].\n\n[^a]: - [ ] $$\n    x = 1\n    $$\n\nTail";
    const streamed = render(chatMarkdown(reply.slice(0, 20), true));
    const history = render(chatMarkdown(reply));
    const footnoteMath = (container: HTMLElement) =>
      container.querySelector("section[data-footnotes] .katex-display")?.textContent;

    try {
      await waitFor(() => expect(footnoteMath(history.container)).toContain("x=1"), {
        timeout: 3000,
      });
      streamed.rerender(chatMarkdown(reply, true));
      streamed.rerender(chatMarkdown(reply));

      await waitFor(
        () => expect(footnoteMath(streamed.container)).toBe(footnoteMath(history.container)),
        { timeout: 3000 },
      );
    } finally {
      streamed.unmount();
      history.unmount();
    }
  }, 4000);
});
