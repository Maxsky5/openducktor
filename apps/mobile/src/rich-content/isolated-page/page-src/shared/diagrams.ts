/** Mermaid diagrams for the diagram page, drawn with Pele. Pele escapes diagram text and filters links. */
import {
  DIAGRAM_RENDER_OPTIONS,
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

/**
 * The mobile base colors of the diagram theme in `@openducktor/theme/diagrams.css`. Node tints mix
 * into white on light, so nodes sit above the screen background. On dark, warm hues mix into a
 * neutral base, because the navy background would gray them.
 */
const BASE_COLORS = {
  light: {
    "--diagram-node-base": "white",
    "--diagram-surface": "white",
    "--diagram-warm-base": "white",
  },
  dark: {
    "--diagram-node-base": "var(--pele-bg)",
    "--diagram-surface": "color-mix(in oklab, var(--pele-fg) 5%, var(--pele-bg))",
    // The screen background of the app is darker than the desktop diagram canvas.
    "--diagram-warm-base": "oklch(0.17 0.008 265)",
  },
} as const;

/** The diagram colors in the app colors, with the screen background as the canvas. */
const diagramColors = ({ colors, theme }: BlockRenderMessage) => ({
  ...BASE_COLORS[theme],
  "--pele-bg": colors.background,
  "--pele-fg": colors.label,
  "--pele-muted": colors.secondaryLabel,
  "--pele-surface": colors.codeBackground,
  "--pele-surface-alt": colors.fill,
  "--pele-border": colors.separator,
  "--pele-error": colors.error,
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
  ...DIAGRAM_RENDER_OPTIONS,
};

/** Replaces each `mermaid` code block with its diagram. Pele draws synchronously. */
export const renderDiagrams: DiagramRenderer = (root, message) => {
  const colors = diagramColors(message);
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
    // An SVG image cannot read the page, so each drawing carries its theme and colors to its PNG
    // picture.
    const svg = figure.querySelector("svg");
    if (svg) {
      if (message.theme === "dark") svg.setAttribute("class", `${svg.getAttribute("class")} dark`);
      for (const [name, value] of Object.entries(colors)) svg.style.setProperty(name, value);
    }
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
