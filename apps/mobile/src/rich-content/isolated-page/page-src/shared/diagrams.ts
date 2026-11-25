/** Mermaid diagrams for the diagram page, drawn with Pele. Pele escapes diagram text and filters links. */
import {
  DIAGRAM_CONFIG,
  DIAGRAM_MONOSPACE,
  prepareDiagram,
} from "@openducktor/frontend-core/lib/diagram-drawing";
import diagramStyles from "@openducktor/theme/diagrams.css" with { type: "text" };
import { render } from "pele";
import { type BlockRenderMessage, MAX_SNAPSHOT_LENGTH } from "../../block-page-messages";
import type { BlockSnapshotter, DiagramRenderer } from "./block-page";
import { drawElementPng, pageDocument } from "./page-runtime";

// Diagrams keep the system font, unlike the text of the page. The diagram picture draws the SVG
// as an image, which cannot use the fonts of the page.
const FONT_FAMILY = "-apple-system, system-ui, sans-serif";
const FONT_FAMILY_MONO = "ui-monospace, Menlo, monospace";

const FG_ON_LIGHT = "oklch(0.21 0.034 264.665)";
const FG_ON_DARK = "oklch(0.984 0.003 247.858)";

/**
 * The mobile values of the diagram theme in `@openducktor/theme/diagrams.css`, as on desktop:
 * Tailwind 500 shades on light and 400 shades on dark. Node tints mix into white on light, so nodes
 * sit above the screen background. On dark, warm hues mix into a neutral base, because the navy
 * background would gray them.
 */
const THEME_VALUES = {
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
    "--diagram-text-mix": "35%",
    "--diagram-solid-mix": "85%",
    "--diagram-event-opacity": "0.1",
    "--diagram-node-base": "white",
    "--diagram-surface": "white",
    "--diagram-warm-base": "white",
    "--diagram-author-l": "l",
    "--diagram-author-c": "c",
    "--diagram-author-alpha": "alpha",
    "--diagram-sequence-on-light": FG_ON_LIGHT,
    "--diagram-sequence-on-dark": FG_ON_DARK,
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
    "--diagram-text-mix": "25%",
    "--diagram-solid-mix": "100%",
    "--diagram-event-opacity": "0.14",
    "--diagram-node-base": "var(--pele-bg)",
    "--diagram-surface": "color-mix(in oklab, var(--pele-fg) 5%, var(--pele-bg))",
    // The screen background of the app is darker than the desktop diagram canvas.
    "--diagram-warm-base": "oklch(0.17 0.008 265)",
    "--diagram-author-l": "0.28",
    "--diagram-author-c": "min(c * 0.9 + 0.02, 0.07)",
    "--diagram-author-alpha": "max(alpha, 0.6)",
    "--diagram-sequence-on-light": "var(--pele-fg)",
    "--diagram-sequence-on-dark": "var(--pele-fg)",
  },
} as const;

/** The diagram colors in the app colors, with the screen background as the canvas. */
const diagramColors = ({ colors, theme }: BlockRenderMessage) => ({
  ...THEME_VALUES[theme],
  "--pele-bg": colors.background,
  "--pele-fg": colors.label,
  "--pele-fg-on-light": FG_ON_LIGHT,
  "--pele-fg-on-dark": FG_ON_DARK,
  "--pele-muted": colors.secondaryLabel,
  "--pele-surface": colors.codeBackground,
  "--pele-surface-alt": colors.fill,
  "--pele-border": colors.separator,
  "--pele-error": colors.error,
  "--pele-font": FONT_FAMILY,
  "--diagram-rule": colors.separator,
});

/**
 * The shared diagram theme, without its comments. The style sits in each drawing, so the PNG
 * picture of a diagram keeps the colors.
 */
const THEME_STYLE = `<style>${diagramStyles.replace(/\/\*[\s\S]*?\*\//g, "")}</style>`;

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
  const blocks = Array.from(
    root.querySelectorAll('[data-markdown="code-block"][data-language="mermaid"]'),
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
