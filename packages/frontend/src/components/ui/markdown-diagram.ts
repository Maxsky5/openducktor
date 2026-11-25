/**
 * Draws Mermaid diagrams with Pele. Pele is large, so it loads the first time that a view shows a
 * diagram. Pele draws synchronously and needs no DOM.
 */
import { escapeHtml, type PluginConfig } from "@pierre/words/html";
import { createMermaidPlugin } from "@pierre/words/mermaid";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { createLazyModule, type LazyModuleState } from "./markdown-lazy-module";

type PeleRender = (typeof import("pele"))["render"];
type DiagramRendererEntry = NonNullable<PluginConfig["renderers"]>[number];

/**
 * The fonts of the app text. Pele measures each label in the font that draws it, so a label
 * fits its box and keeps clear of the lines.
 */
const DIAGRAM_OPTIONS = {
  fontFamily: '"Space Grotesk", "Avenir Next", "Segoe UI", sans-serif',
  fontFamilyMono: '"IBM Plex Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
  fontSize: 14,
  // Right-angle edges with rounded corners.
  config: { flowchart: { curve: "step" } },
};

export type DiagramRenderer = LazyModuleState<PeleRender>;

const pele = createLazyModule(() => import("pele").then((module) => module.render));

/** The diagram renderer. It starts to load when `needed` is true. */
export const useDiagramRenderer = (needed: boolean): DiagramRenderer => pele.useModule(needed);

/** A fence that a view draws as a diagram. The check is cheap, and it can be wrong only one way. */
export const mayHaveDiagram = (markdown: string): boolean => markdown.includes("mermaid");

export type DrawnDiagram = { status: "ready"; svg: string } | { status: "error"; message: string };

export const drawDiagram = (render: PeleRender, source: string): DrawnDiagram => {
  try {
    return { status: "ready", svg: render(source, DIAGRAM_OPTIONS).svg };
  } catch (cause) {
    return { status: "error", message: errorMessage(cause) };
  }
};

const ALERT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 size-4 shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>';

const EXPAND_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4" aria-hidden="true"><path d="m15 15 6 6"/><path d="m15 9 6-6"/><path d="M21 16v5h-5"/><path d="M21 8V3h-5"/><path d="M3 16v5h5"/><path d="m3 21 6-6"/><path d="M3 8V3h5"/><path d="M9 9 3 3"/></svg>';

/** The attribute of a drawn diagram. A click on it opens the diagram in the preview dialog. */
export const DIAGRAM_ATTRIBUTE = "data-diagram";

const SVG_WIDTH = /^<svg\b[^>]*?\swidth="([\d.]+)"/;

/** The drawing keeps its width for the CSS minimum scale in `markdown.css`. */
const diagramHtml = (svg: string): string =>
  `<div data-markdown="mermaid" ${DIAGRAM_ATTRIBUTE}="" style="--diagram-width:${Number(SVG_WIDTH.exec(svg)?.[1] ?? 0)}px">${svg}` +
  `<button type="button" data-diagram-expand="" aria-label="Open diagram preview" title="Open diagram preview">${EXPAND_ICON}</button></div>`;

const diagramErrorHtml = (title: string, message: string, action: string): string =>
  `<div data-diagram-error="" role="alert">${ALERT_ICON}<div><p class="font-medium">${escapeHtml(title)}</p>` +
  `<p class="whitespace-pre-wrap font-mono text-xs">${escapeHtml(message)}</p>` +
  `<p class="text-xs">${escapeHtml(action)}</p></div></div>`;

const LOADING_HTML = '<div data-diagram-loading="" role="status">Loading diagram…</div>';

/**
 * The Words renderer of `mermaid` fences, without the code frame. An open fence shows the last
 * complete diagram, as Words does. A closed fence shows its diagram, or the parse error and what
 * to do.
 */
export const createDiagramRenderer = (state: DiagramRenderer): DiagramRendererEntry => {
  const entry = (render: DiagramRendererEntry["render"]): DiagramRendererEntry => ({
    language: "mermaid",
    frame: false,
    render,
  });
  if (state.status === "loading") return entry(() => LOADING_HTML);
  if (state.status === "failed") {
    const html = diagramErrorHtml(
      "Diagram renderer failed to load",
      state.message,
      "Reload the app to show diagrams.",
    );
    return entry(() => html);
  }
  const render = state.value;
  const streaming = createMermaidPlugin({ render }, DIAGRAM_OPTIONS);
  return entry((options) => {
    if (options.isIncomplete) return streaming.render(options);
    const drawn = drawDiagram(render, options.code);
    return drawn.status === "ready"
      ? diagramHtml(drawn.svg)
      : diagramErrorHtml(
          "Diagram preview failed",
          drawn.message,
          "Edit the Mermaid source to fix the diagram.",
        );
  });
};
