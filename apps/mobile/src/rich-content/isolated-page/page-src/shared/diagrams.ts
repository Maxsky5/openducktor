/** Mermaid diagrams for the diagram page, drawn with Pele. Pele escapes diagram text and filters links. */
import {
  DIAGRAM_CONFIG,
  DIAGRAM_MONOSPACE,
  DIAGRAM_RADIUS,
  prepareDiagram,
} from "@openducktor/frontend-core/lib/diagram-drawing";
import { render } from "pele";
import { type BlockRenderMessage, MAX_SNAPSHOT_LENGTH } from "../../block-page-messages";
import type { BlockSnapshotter, DiagramRenderer } from "./block-page";
import { drawElementPng, pageDocument } from "./page-runtime";

// Diagrams keep the system font, unlike the text of the page. The diagram picture draws the SVG
// as an image, which cannot use the fonts of the page.
const FONT_FAMILY = "-apple-system, system-ui, sans-serif";
const FONT_FAMILY_MONO = "ui-monospace, Menlo, monospace";

/**
 * The tint hues of diagram parts, as on desktop: Tailwind 500 shades on light and 400 shades on
 * dark. Node tints mix into white on light, so nodes sit above the screen background. On dark,
 * warm hues mix into a neutral base, because the navy background would gray them.
 */
const HUES = {
  light: {
    "--diagram-indigo": "oklch(0.585 0.233 277.117)",
    "--diagram-sky": "oklch(0.685 0.169 237.323)",
    "--diagram-emerald": "oklch(0.696 0.17 162.48)",
    "--diagram-amber": "oklch(0.769 0.188 70.08)",
    "--diagram-rose": "oklch(0.645 0.246 16.439)",
    "--diagram-fuchsia": "oklch(0.667 0.295 322.15)",
    "--diagram-violet": "oklch(0.606 0.25 292.717)",
    "--diagram-lime": "oklch(0.648 0.2 131.684)",
    "--diagram-fill-mix": "15%",
    "--diagram-line-mix": "62%",
    "--diagram-text-mix": "58%",
    "--diagram-solid-mix": "85%",
    "--diagram-event-opacity": "0.1",
    "--diagram-node-base": "white",
    "--diagram-surface": "white",
    "--diagram-warm-base": "white",
    "--diagram-author-l": "l",
    "--diagram-author-c": "c",
    "--diagram-author-alpha": "alpha",
  },
  dark: {
    "--diagram-indigo": "oklch(0.673 0.182 276.935)",
    "--diagram-sky": "oklch(0.746 0.16 232.661)",
    "--diagram-emerald": "oklch(0.765 0.177 163.223)",
    "--diagram-amber": "oklch(0.828 0.189 84.429)",
    "--diagram-rose": "oklch(0.712 0.194 13.428)",
    "--diagram-fuchsia": "oklch(0.74 0.238 322.16)",
    "--diagram-violet": "oklch(0.702 0.183 293.541)",
    "--diagram-lime": "oklch(0.841 0.238 128.85)",
    "--diagram-fill-mix": "20%",
    "--diagram-line-mix": "70%",
    "--diagram-text-mix": "30%",
    "--diagram-solid-mix": "100%",
    "--diagram-event-opacity": "0.14",
    "--diagram-node-base": "var(--pele-bg)",
    "--diagram-surface": "color-mix(in oklab, var(--pele-fg) 5%, var(--pele-bg))",
    "--diagram-warm-base": "oklch(0.17 0.008 265)",
    "--diagram-author-l": "0.28",
    "--diagram-author-c": "min(c * 0.9 + 0.02, 0.07)",
    "--diagram-author-alpha": "max(alpha, 0.6)",
  },
} as const;

/** The Pele colors in the app colors. `THEME_STYLE` tints the parts from them. */
const diagramColors = ({ colors, theme }: BlockRenderMessage) => ({
  ...HUES[theme],
  "--pele-bg": colors.background,
  "--pele-fg": colors.label,
  "--pele-fg-on-light": "oklch(0.21 0.034 264.665)",
  "--pele-fg-on-dark": "oklch(0.984 0.003 247.858)",
  "--pele-muted": colors.secondaryLabel,
  "--pele-line": `color-mix(in oklab, ${HUES[theme]["--diagram-indigo"]} 25%, ${colors.secondaryLabel})`,
  "--pele-surface": colors.codeBackground,
  "--pele-surface-alt": colors.fill,
  "--pele-border": colors.separator,
  "--pele-accent": HUES[theme]["--diagram-indigo"],
  "--pele-critical": HUES[theme]["--diagram-rose"],
  "--pele-error": colors.error,
  "--pele-font": FONT_FAMILY,
  "--pele-radius": `${DIAGRAM_RADIUS}px`,
  "--diagram-rule": colors.separator,
});

/**
 * The part colors of `markdown.css` on desktop, with the screen background as the canvas. The
 * style sits in each drawing, so the PNG picture of a diagram keeps the colors.
 */
const THEME_STYLE = `<style>
.pele {
  text-rendering: geometricPrecision;
  --pele-series-1: var(--diagram-indigo);
  --pele-series-2: var(--diagram-sky);
  --pele-series-3: var(--diagram-emerald);
  --pele-series-4: var(--diagram-amber);
  --pele-series-5: var(--diagram-rose);
  --pele-series-6: var(--diagram-fuchsia);
  --pele-series-7: var(--diagram-violet);
  --pele-series-8: var(--pele-muted);
}
:is(.pele-flowchart, .pele-state, .pele-sequence, .pele-class, .pele-er, .pele-gantt, .pele-journey) :is(.pele-node, .pele-note, .pele-task, .pele-frame, .pele-cluster) {
  --hue: var(--diagram-indigo);
  --tint-base: var(--diagram-node-base);
  --_s: color-mix(in oklab, var(--hue) var(--diagram-fill-mix), var(--tint-base));
  --_a: var(--_s);
  --_b: color-mix(in oklab, var(--hue) var(--diagram-line-mix), var(--pele-bg));
  --_c: var(--hue);
}
:is(.pele-flowchart, .pele-state, .pele-sequence, .pele-class, .pele-er, .pele-gantt) :is(.pele-node, .pele-note, .pele-task) .pele-label,
.pele-journey .pele-task > text {
  fill: color-mix(in oklab, var(--hue) var(--diagram-text-mix), var(--pele-fg));
}
.pele :is(.pele-shape-diam, .pele-note) { --hue: var(--diagram-amber); --tint-base: var(--diagram-warm-base); }
.pele :is(.pele-shape-stadium, .pele-shape-circle, .pele-shape-dbl-circ, .pele-state-start, .pele-state-end) { --hue: var(--diagram-emerald); }
.pele .pele-shape-cyl, .pele-state .pele-node:not(.pele-state-start, .pele-state-end), .pele-gantt .pele-task { --hue: var(--diagram-sky); }
.pele :is(.pele-shape-hex, .pele-shape-fr-rect, .pele-shape-odd) { --hue: var(--diagram-fuchsia); --tint-base: var(--diagram-warm-base); }
.pele-gantt .pele-crit { --hue: var(--diagram-rose); --tint-base: var(--diagram-warm-base); }
.pele-gantt .pele-done { --hue: var(--diagram-emerald); }
.pele-gantt .pele-active { --hue: var(--diagram-indigo); }
.pele-mindmap .pele-root { --_s: var(--diagram-surface); --_b: color-mix(in oklab, var(--pele-fg) 25%, var(--pele-bg)); stroke-width: 1.5; }
.pele-mindmap .pele-root .pele-label { fill: var(--pele-fg); }
.pele :is(.pele-state-start, .pele-state-end) { --_l: var(--hue); --_fg: var(--hue); stroke-width: 1.5; }
.pele :is(.pele-cluster, .pele-frame) { --hue: var(--diagram-violet); --_s: color-mix(in oklab, var(--hue) 4%, var(--pele-bg)); }
.pele-cluster > rect, .pele-frame > rect:first-child { stroke: var(--_b); stroke-dasharray: 5 4; }
.pele .pele-frame-critical { --hue: var(--diagram-rose); }
.pele .pele-frame-break { --hue: var(--diagram-amber); }
.pele-frame > rect:first-child { fill: color-mix(in oklab, var(--hue) 3%, transparent); }
.pele-sequence .pele-frame > rect:first-child { stroke-dasharray: none; }
.pele-frame > path { stroke: var(--_b); }
.pele-frame > rect:has(+ .pele-frame-kind) { fill: color-mix(in oklab, var(--hue) 18%, var(--pele-bg)); }
.pele-frame > rect:has(+ .pele-frame-label) { fill: none; }
.pele-cluster-label, .pele-frame-label, .pele-frame-kind { fill: color-mix(in oklab, var(--hue) 66%, var(--pele-fg)); font-weight: 600; }
.pele .pele-note rect { fill: var(--_s); stroke: var(--_b); }
.pele-sequence > * { --_l: color-mix(in oklab, var(--pele-fg) 78%, var(--pele-bg)); }
.pele.pele-sequence .pele-hue-0 { --hue: var(--diagram-fuchsia); --tint-base: var(--diagram-warm-base); }
.pele.pele-sequence .pele-hue-1 { --hue: var(--diagram-emerald); }
.pele.pele-sequence .pele-hue-2 { --hue: var(--diagram-amber); --tint-base: var(--diagram-warm-base); }
.pele.pele-sequence .pele-hue-3 { --hue: var(--diagram-sky); }
.pele.pele-sequence .pele-hue-4 { --hue: var(--diagram-rose); --tint-base: var(--diagram-warm-base); }
.pele.pele-sequence .pele-hue-5 { --hue: var(--diagram-lime); }
.pele.pele-sequence :is(.pele-actor, .pele-lifeline, .pele-activation) { --_b: color-mix(in oklab, var(--hue) 66%, var(--pele-fg)); }
.pele.pele-sequence .pele-note { --_s: color-mix(in oklab, var(--pele-fg) 5%, var(--diagram-node-base)); --_b: color-mix(in oklab, var(--pele-fg) 30%, var(--pele-bg)); }
.pele.pele-sequence .pele-note .pele-label { fill: var(--pele-fg); }
.pele.pele-sequence :is(.pele-edge-label text, .pele-frame-label) { paint-order: stroke; stroke: var(--pele-bg); stroke-width: 3px; stroke-linejoin: round; }
.pele.pele-sequence .pele-activation { fill: color-mix(in oklab, var(--hue) calc(var(--diagram-fill-mix) * 1.6), var(--diagram-node-base)); stroke: var(--_b); }
.pele.pele-sequence .pele-actor .pele-label { fill: var(--pele-fg); }
.pele.pele-sequence .pele-edge-label { fill: color-mix(in oklab, var(--pele-fg) 90%, var(--pele-muted)); }
.pele-sequence-number > rect { fill: var(--pele-fg); }
.pele-sequence [style*="--author-fill"] { fill: oklch(from var(--author-fill) var(--diagram-author-l) var(--diagram-author-c) h / var(--diagram-author-alpha)); }
.pele-sequence .pele-message { stroke: var(--_l); }
.pele-sequence .pele-marker[fill^="var(--pele-fg-on"] { fill: var(--_l); }
.pele-sequence .pele-edge-label text[fill^="var(--pele-fg-on"] { fill: inherit; }
.pele-sequence :is(.pele-actor-actor, .pele-actor-boundary, .pele-actor-control, .pele-actor-entity, .pele-actor-database) > :is(circle, path) { stroke-width: 1.5; }
.pele-gantt .pele-task { --_r: 4px; }
.pele-gantt .pele-task > rect { fill: var(--_s); fill-opacity: 1; stroke: var(--_b); }
.pele-gantt :is(.pele-task .pele-label, .pele-section-label) { font-weight: 500; }
.pele-gantt .pele-section-label { fill: var(--pele-fg); }
.pele-gantt .pele-section:not([fill="none"]) { fill: color-mix(in oklab, var(--pele-muted) 7%, transparent); rx: 6px; }
.pele :is(.pele-node.pele-class, .pele-node.pele-entity) { --diagram-header-fill: color-mix(in oklab, var(--hue) calc(var(--diagram-fill-mix) * 1.6), var(--tint-base)); }
.pele .pele-node-header { fill: var(--diagram-header-fill); stroke: none; }
.pele :is(.pele-node.pele-class, .pele-node.pele-entity):not(:has(.pele-node-header)) > rect { fill: var(--diagram-header-fill); }
.pele :is(.pele-node.pele-class, .pele-node.pele-entity):has(.pele-node-header) > rect:first-child { fill: color-mix(in oklab, var(--hue) calc(var(--diagram-fill-mix) / 3), var(--tint-base)); }
.pele-er-stripes { fill: color-mix(in oklab, var(--hue) calc(var(--diagram-fill-mix) * 0.8), var(--tint-base)); }
.pele-class .pele-attribute { fill: color-mix(in oklab, var(--pele-fg) 85%, var(--pele-muted)); }
.pele .pele-annotation { fill: color-mix(in oklab, var(--pele-muted) 45%, var(--pele-fg)); }
.pele-class .pele-method { fill: color-mix(in oklab, var(--hue) var(--diagram-text-mix), var(--pele-fg)); }
.pele :is(.pele-er-type, .pele-member) { fill: color-mix(in oklab, var(--pele-muted) 60%, var(--pele-fg)); }
.pele:is(.pele-class, .pele-er) .pele-node > .pele-label { font-weight: 600; }
:is(.pele-timeline .pele-period, .pele-gitGraph .pele-branch) > rect { fill-opacity: 0.32; }
:is(.pele-timeline .pele-period, .pele-gitGraph .pele-branch) text { fill: var(--pele-fg); font-weight: 600; }
.pele-timeline .pele-event > rect { fill-opacity: var(--diagram-event-opacity); }
.pele-timeline .pele-event text { font-weight: 500; }
.pele-gitGraph .pele-lane { opacity: 0.4; }
.pele-gitGraph .pele-commit-label > rect { stroke: var(--pele-bg); stroke-width: 4px; }
.pele-pie {
  --pele-series-1: color-mix(in oklab, var(--diagram-indigo) var(--diagram-solid-mix), white);
  --pele-series-2: color-mix(in oklab, var(--diagram-sky) var(--diagram-solid-mix), white);
  --pele-series-3: color-mix(in oklab, var(--diagram-emerald) var(--diagram-solid-mix), white);
  --pele-series-4: color-mix(in oklab, var(--diagram-amber) var(--diagram-solid-mix), white);
  --pele-series-5: color-mix(in oklab, var(--diagram-rose) var(--diagram-solid-mix), white);
  --pele-series-6: color-mix(in oklab, var(--diagram-fuchsia) var(--diagram-solid-mix), white);
  --pele-series-7: color-mix(in oklab, var(--diagram-violet) var(--diagram-solid-mix), white);
}
.pele-pie .pele-slice-labels { fill: var(--pele-fg-on-light); font-weight: 600; }
.pele-slice { stroke: var(--pele-bg); stroke-width: 2.5px; }
.pele-face { --face: var(--diagram-amber); }
.pele-face-happy { --face: var(--diagram-emerald); }
.pele-face-sad { --face: var(--diagram-rose); }
.pele-face > circle { fill: color-mix(in oklab, var(--face) 22%, var(--diagram-warm-base)); stroke: var(--face); }
.pele-face > g { fill: color-mix(in oklab, var(--face) 70%, var(--pele-fg)); }
.pele-journey .pele-grid { stroke: var(--diagram-rule); }
.pele-journey .pele-section > rect { fill: color-mix(in oklab, var(--diagram-indigo) 26%, var(--pele-bg)); stroke: none; }
.pele-journey .pele-section > text { fill: color-mix(in oklab, var(--diagram-indigo) var(--diagram-text-mix), var(--pele-fg)); }
.pele-journey .pele-task { --diagram-line-mix: 45%; }
.pele-journey path.pele-edge { stroke-width: 1.5; }
.pele-node .pele-label { font-weight: 500; }
.pele-sequence .pele-actor .pele-label { font-weight: 500; }
.pele-mindmap .pele-root .pele-label { font-weight: 600; }
.pele-edge path:not(.pele-marker) { stroke-width: 1.5; }
.pele-edge .pele-marker { stroke: var(--_l); stroke-width: 1.5; stroke-linejoin: round; }
.pele-edge-label { fill: color-mix(in oklab, var(--pele-fg) 40%, var(--pele-muted)); font-weight: 500; }
.pele-cardinality { fill: color-mix(in oklab, var(--pele-fg) 40%, var(--pele-muted)); font-weight: 500; paint-order: stroke; stroke: var(--pele-bg); stroke-width: 3px; stroke-linejoin: round; }
.pele-lifeline { stroke: var(--diagram-rule); stroke-dasharray: 2 4; }
.pele.pele-sequence .pele-lifeline { stroke: var(--_b); stroke-width: 1.5; stroke-dasharray: none; }
</style>`;

const SVG_OPEN_TAG = /^<svg\b[^>]*>/;

/** The layout options of desktop, with the system fonts. */
const RENDER_OPTIONS = {
  fontFamily: FONT_FAMILY,
  fontFamilyMono: FONT_FAMILY_MONO,
  monospace: DIAGRAM_MONOSPACE,
  config: DIAGRAM_CONFIG,
};

let colors: Record<string, string> | null = null;

/** Replaces each `mermaid` code block with its diagram. Pele draws synchronously. */
export const renderDiagrams: DiagramRenderer = (root, message) => {
  colors = diagramColors(message);
  for (const [name, value] of Object.entries(colors)) root.style.setProperty(name, value);
  const blocks = Array.from(root.querySelectorAll('[data-markdown="code-block"]')).filter(
    (block) => block.getAttribute("data-language") === "mermaid",
  );
  for (const block of blocks) {
    const source = block.querySelector("code")?.textContent ?? "";
    const figure = pageDocument.createElement("div");
    figure.className = "diagram";
    // Pele escapes diagram text and filters links and styles, and the page policy runs only the
    // page script.
    // react-doctor-disable-next-line react-doctor/dangerous-html-sink
    figure.innerHTML = prepareDiagram(render(source, RENDER_OPTIONS).svg).replace(
      SVG_OPEN_TAG,
      (tag) => tag + THEME_STYLE,
    );
    block.replaceWith(figure);
  }
};

/**
 * A PNG of a block that is one diagram, so the app shows the same picture again without running
 * Pele. The picture is only a cache of the drawn block. When the page cannot draw it, the block
 * has no picture, and the app renders it again the next time: WebKit gives no 2D context for a
 * canvas over its area limit, and can fail to decode a large SVG. A PNG over the message limit
 * also gives no picture.
 */
export const snapshotDiagram: BlockSnapshotter = async (root) => {
  const figures = root.children;
  const figure = figures.length === 1 ? figures[0] : undefined;
  const svg = figure?.className === "diagram" ? figure.querySelector("svg") : null;
  if (!figure || !svg) return null;
  const block = root.getBoundingClientRect();
  const place = svg.getBoundingClientRect();
  // The page scales the SVG to its width. The picture keeps that size.
  const sized = svg.cloneNode(true);
  sized.setAttribute("width", String(place.width));
  sized.setAttribute("height", String(place.height));
  sized.style.removeProperty("max-width");
  // An SVG image cannot read the variables of the page, so the picture carries its colors.
  for (const [name, value] of Object.entries(colors ?? {})) sized.style.setProperty(name, value);
  let image: string;
  try {
    image = await drawElementPng(sized, place);
  } catch {
    return null;
  }
  if (image.length > MAX_SNAPSHOT_LENGTH) return null;
  return {
    image,
    x: place.left - block.left,
    y: place.top - block.top,
    width: place.width,
    height: place.height,
  };
};
