/**
 * Draws Mermaid diagrams with Pele. Pele is large, so it loads the first time that a view shows a
 * diagram. Pele draws synchronously and needs no DOM.
 */
import { escapeHtml, type PluginConfig } from "@pierre/words/html";
import { createMermaidPlugin } from "@pierre/words/mermaid";
import {
  DIAGRAM_RENDER_OPTIONS,
  prepareDiagram,
} from "@openducktor/frontend-core/lib/diagram-drawing";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { createLazyModule, type LazyModuleState } from "./markdown-lazy-module";

type PeleRender = (typeof import("pele"))["render"];
type DiagramRendererEntry = NonNullable<PluginConfig["renderers"]>[number];

/** Diagrams use the fonts of the app text. */
const DIAGRAM_OPTIONS = {
  fontFamily: '"Space Grotesk", "Avenir Next", "Segoe UI", sans-serif',
  fontFamilyMono: '"IBM Plex Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
  fontSize: 14,
  ...DIAGRAM_RENDER_OPTIONS,
};

export type DiagramRenderer = LazyModuleState<PeleRender>;

/** Pele with the preparation step that the diagram styles need, on every drawing. */
const withPreparation =
  (render: PeleRender): PeleRender =>
  (source, options) => {
    const drawn = render(source, options);
    return { ...drawn, svg: prepareDiagram(drawn.svg) };
  };

/**
 * Pele measures each label in the font that draws it, so a label fits its box. Pele therefore loads
 * with the diagram fonts. Class members use the code font, which the app loads only when a view
 * first shows code.
 */
const pele = createLazyModule(() =>
  Promise.all([
    import("pele"),
    document.fonts.load(`500 ${DIAGRAM_OPTIONS.fontSize}px ${DIAGRAM_OPTIONS.fontFamily}`),
    document.fonts.load(`${DIAGRAM_OPTIONS.fontSize}px ${DIAGRAM_OPTIONS.fontFamilyMono}`),
  ]).then(([module]) => withPreparation(module.render)),
);

/** The diagram renderer. It starts to load when `needed` is true. */
export const useDiagramRenderer = (needed: boolean): DiagramRenderer => pele.useModule(needed);

/** A fence opener with the `mermaid` language, also in a list item or a quote. */
const MERMAID_FENCE = /(?:`{3,}|~{3,})\s*mermaid\b/;

/**
 * A fence that a view draws as a diagram. The check is cheap. It can find a fence that is not
 * there, such as one in an inline code span, but it never misses one.
 */
export const mayHaveDiagram = (markdown: string): boolean => MERMAID_FENCE.test(markdown);

type DrawnDiagram = { status: "ready"; svg: string } | { status: "error"; message: string };

/**
 * The last drawings, by source. A view draws its diagrams when it mounts, and chat rows and
 * dialogs mount again often, so they reuse the drawing.
 */
const drawings = new Map<string, DrawnDiagram>();
const DRAWING_LIMIT = 64;

const draw = (render: PeleRender, source: string): DrawnDiagram => {
  try {
    return { status: "ready", svg: render(source, DIAGRAM_OPTIONS).svg };
  } catch (cause) {
    return { status: "error", message: errorMessage(cause) };
  }
};

/** Draws a diagram, or returns the last drawing of the same source. */
const drawDiagram = (render: PeleRender, source: string): DrawnDiagram => {
  const cached = drawings.get(source);
  if (cached) {
    // The map keeps insertion order, so a reused drawing moves to the end.
    drawings.delete(source);
    drawings.set(source, cached);
    return cached;
  }
  const drawn = draw(render, source);
  drawings.set(source, drawn);
  if (drawings.size > DRAWING_LIMIT) {
    const oldest = drawings.keys().next();
    if (!oldest.done) drawings.delete(oldest.value);
  }
  return drawn;
};

/** A diagram that cannot show, with what the user can do. */
type DiagramFailure = { title: string; message: string; action: string };

const rendererFailure = (message: string): DiagramFailure => ({
  title: "Diagram renderer failed to load",
  message,
  action: "Reload the app to show diagrams.",
});

const sourceFailure = (message: string): DiagramFailure => ({
  title: "Diagram preview failed",
  message,
  action: "Edit the Mermaid source to fix the diagram.",
});

const ALERT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 size-4 shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>';

const EXPAND_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4" aria-hidden="true"><path d="m15 15 6 6"/><path d="m15 9 6-6"/><path d="M21 16v5h-5"/><path d="M21 8V3h-5"/><path d="M3 16v5h5"/><path d="m3 21 6-6"/><path d="M3 8V3h5"/><path d="M9 9 3 3"/></svg>';

/** The attribute of a drawn diagram. A click on it opens the diagram in the preview dialog. */
export const DIAGRAM_ATTRIBUTE = "data-diagram";

const EXPAND_BUTTON = `<button type="button" data-diagram-expand="" aria-label="Open diagram preview" title="Open diagram preview">${EXPAND_ICON}</button>`;

const drawingHtml = (svg: string, preview: boolean): string =>
  preview
    ? `<div data-markdown="mermaid" ${DIAGRAM_ATTRIBUTE}="">${svg}${EXPAND_BUTTON}</div>`
    : `<div data-markdown="mermaid">${svg}</div>`;

const diagramErrorHtml = ({ title, message, action }: DiagramFailure): string =>
  `<div data-diagram-error="" role="alert">${ALERT_ICON}<div><p class="font-medium">${escapeHtml(title)}</p>` +
  `<p class="whitespace-pre-wrap font-mono text-xs">${escapeHtml(message)}</p>` +
  `<p class="text-xs">${escapeHtml(action)}</p></div></div>`;

const LOADING_HTML = '<div data-diagram-loading="" role="status">Loading diagram…</div>';

/**
 * The HTML of a diagram source: the diagram, or what failed and what to do. With `preview`, a click
 * on the diagram opens it in the preview dialog.
 */
export const diagramHtml = (state: DiagramRenderer, source: string, preview: boolean): string => {
  if (state.status === "loading") return LOADING_HTML;
  if (state.status === "failed") return diagramErrorHtml(rendererFailure(state.message));
  const drawn = drawDiagram(state.value, source);
  return drawn.status === "ready"
    ? drawingHtml(drawn.svg, preview)
    : diagramErrorHtml(sourceFailure(drawn.message));
};

/**
 * The Words renderer of `mermaid` fences, without the code frame. An open fence shows the last
 * complete diagram, as Words does. A closed fence shows its diagram, or the parse error and what
 * to do.
 */
export const createDiagramRenderer = (state: DiagramRenderer): DiagramRendererEntry => {
  const streaming =
    state.status === "ready" ? createMermaidPlugin({ render: state.value }, DIAGRAM_OPTIONS) : null;
  return {
    language: "mermaid",
    frame: false,
    render: (options) =>
      streaming && options.isIncomplete
        ? streaming.render(options)
        : diagramHtml(state, options.code, true),
  };
};
