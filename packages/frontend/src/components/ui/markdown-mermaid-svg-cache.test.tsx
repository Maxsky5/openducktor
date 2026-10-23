import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, render, waitFor } from "@testing-library/react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { createIntersectionObserverTestDriver } from "@/test-utils/intersection-observer-test-driver";
import { MarkdownMermaid } from "./markdown-mermaid";
import * as renderModule from "./markdown-mermaid-render";
import { drawMermaidSvg, type MermaidSvgCache, peekMermaidSvg } from "./markdown-mermaid-svg-cache";
import { MermaidSvgCacheProvider } from "./markdown-mermaid-svg-cache-context";

enableReactActEnvironment();

const SOURCE = "graph TD\n  A --> B";

const svgFor = (renderId: string): string =>
  `<svg id="${renderId}"><g id="${renderId}-node"><text>Diagram</text></g></svg>`;

const expectOwnIds = (svg: SVGSVGElement | null | undefined): void => {
  expect(svg?.id).toBeTruthy();
  expect(svg?.querySelector("g")?.id).toBe(`${svg?.id}-node`);
};

describe("MermaidSvgCache", () => {
  const intersections = createIntersectionObserverTestDriver();
  beforeEach(() => intersections.install());
  afterEach(() => intersections.restore());

  test("shows a diagram that mounts again from the cache with its own element ids", async () => {
    const renderSpy = spyOn(renderModule, "renderMermaidSvg").mockImplementation(async (renderId) =>
      svgFor(renderId),
    );
    const diagram = (shown: boolean) => (
      <MermaidSvgCacheProvider>
        {shown ? <MarkdownMermaid source={SOURCE} /> : null}
      </MermaidSvgCacheProvider>
    );
    const view = render(diagram(true));

    try {
      await waitFor(() => expect(view.container.querySelector("svg")?.textContent).toBe("Diagram"));
      const firstId = view.container.querySelector("svg")?.id;

      intersections.setInitiallyVisible(false);
      view.rerender(diagram(false));
      view.rerender(diagram(true));

      const secondSvg = view.container.querySelector("svg");
      expect(secondSvg?.textContent).toContain("Diagram");
      expect(secondSvg?.id).not.toBe(firstId);
      expectOwnIds(secondSvg);
      expect(renderSpy).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      renderSpy.mockRestore();
    }
  });

  test("shows a cached source at once when an offscreen diagram changes source", async () => {
    const renderSpy = spyOn(renderModule, "renderMermaidSvg").mockImplementation(
      async (renderId, source) =>
        `<svg id="${renderId}"><text>${source === SOURCE ? "Cached" : "Other"}</text></svg>`,
    );
    const diagram = (source: string) => (
      <MermaidSvgCacheProvider>
        <MarkdownMermaid source={SOURCE} />
        <MarkdownMermaid source={source} />
      </MermaidSvgCacheProvider>
    );
    const view = render(diagram("graph TD\n  A --> C"));

    try {
      await waitFor(() => expect(view.getByText("Other")).toBeTruthy());
      intersections.setInitiallyVisible(false);
      const observerCount = intersections.observers.length;

      view.rerender(diagram(SOURCE));

      expect(view.getAllByText("Cached")).toHaveLength(2);
      expect(view.queryByText("Other")).toBeNull();
      expect(intersections.observers).toHaveLength(observerCount);
      expect(renderSpy).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      renderSpy.mockRestore();
    }
  });

  test("runs Mermaid once for two diagrams that draw one source at the same time", async () => {
    const pending = Promise.withResolvers<void>();
    const renderSpy = spyOn(renderModule, "renderMermaidSvg").mockImplementation(
      async (renderId) => {
        await pending.promise;
        return svgFor(renderId);
      },
    );
    const view = render(
      <MermaidSvgCacheProvider>
        <MarkdownMermaid source={SOURCE} />
        <MarkdownMermaid source={SOURCE} />
      </MermaidSvgCacheProvider>,
    );

    try {
      await waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1));
      await act(async () => {
        pending.resolve();
        await pending.promise;
      });

      await waitFor(() => expect(view.container.querySelectorAll("svg")).toHaveLength(2));
      const svgs = [...view.container.querySelectorAll("svg")];
      expect(svgs).toHaveLength(2);
      expect(svgs[0]?.id).not.toBe(svgs[1]?.id);
      for (const svg of svgs) {
        expectOwnIds(svg);
      }
      expect(renderSpy).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      renderSpy.mockRestore();
    }
  });

  test("draws a source again after its drawing fails", async () => {
    const renderSpy = spyOn(renderModule, "renderMermaidSvg")
      .mockImplementationOnce(async () => {
        throw new Error("Mermaid could not load.");
      })
      .mockImplementationOnce(async (renderId) => svgFor(renderId));
    const cache: MermaidSvgCache = new Map();

    try {
      const failure = await drawMermaidSvg(cache, SOURCE, "first").catch((cause: unknown) => cause);

      expect(failure).toBeInstanceOf(Error);
      expect(await drawMermaidSvg(cache, SOURCE, "second")).toBe(svgFor("second"));
      expect(renderSpy).toHaveBeenCalledTimes(2);
    } finally {
      renderSpy.mockRestore();
    }
  });

  test("keeps the 100 most recent sources", async () => {
    const renderSpy = spyOn(renderModule, "renderMermaidSvg").mockImplementation(async (renderId) =>
      svgFor(renderId),
    );
    const cache: MermaidSvgCache = new Map();

    try {
      for (let index = 0; index <= 100; index += 1) {
        await drawMermaidSvg(cache, `graph ${index}`, `draw-${index}`);
      }

      expect(peekMermaidSvg(cache, "graph 0", "copy")).toBeNull();
      expect(peekMermaidSvg(cache, "graph 1", "copy")).toBe(svgFor("copy"));
    } finally {
      renderSpy.mockRestore();
    }
  });
});
