import { describe, expect, spyOn, test } from "bun:test";
import mermaid from "mermaid";
import { renderMermaidSvg } from "./markdown-mermaid-render";

describe("renderMermaidSvg", () => {
  test("renders in an isolated fixed container and removes it after success", async () => {
    const renderSpy = spyOn(mermaid, "render");
    let renderContainer: Element | undefined;
    try {
      renderSpy.mockImplementation(async (_id, _source, container) => {
        renderContainer = container;
        if (!(container instanceof HTMLElement)) {
          throw new TypeError("Expected Mermaid to receive an HTML render container.");
        }
        expect(container?.isConnected).toBe(true);
        expect(container?.getAttribute("aria-hidden")).toBe("true");
        expect(container.style.position).toBe("fixed");
        expect(container.style.inset).toBe("0");
        expect(container.style.overflow).toBe("hidden");
        expect(container.style.pointerEvents).toBe("none");

        return {
          diagramType: "flowchart-v2",
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>',
        };
      });

      const svg = await renderMermaidSvg("diagram-id", "graph TD; A --> B");

      expect(svg).toContain("Diagram");
      expect(renderContainer?.isConnected).toBe(false);
    } finally {
      renderSpy.mockRestore();
    }
  });

  test("removes the isolated render container when Mermaid fails", async () => {
    const renderSpy = spyOn(mermaid, "render");
    let renderContainer: Element | undefined;
    try {
      renderSpy.mockImplementation(async (_id, _source, container) => {
        renderContainer = container;
        throw new Error("render failed");
      });

      await expect(renderMermaidSvg("diagram-id", "invalid")).rejects.toThrow("render failed");
      expect(renderContainer?.isConnected).toBe(false);
    } finally {
      renderSpy.mockRestore();
    }
  });
});
