/** Mermaid diagrams for the diagram page, drawn with Pele. Pele escapes diagram text and filters links. */
import { render } from "pele";
import { type BlockRenderMessage, MAX_SNAPSHOT_LENGTH } from "../../block-page-messages";
import type { BlockSnapshotter, DiagramRenderer } from "./block-page";
import { drawElementPng, pageDocument } from "./page-runtime";

// Diagrams keep the system font, unlike the text of the page. The diagram picture draws the SVG
// as an image, which cannot use the fonts of the page.
const FONT_FAMILY = "-apple-system, system-ui, sans-serif";

/**
 * The Pele colors in the app colors: nodes on the code background with tint borders, secondary
 * lines, and groups and notes on the fill.
 */
const diagramColors = ({ colors }: BlockRenderMessage) => ({
  "--pele-bg": colors.background,
  "--pele-fg": colors.label,
  "--pele-muted": colors.secondaryLabel,
  "--pele-line": colors.secondaryLabel,
  "--pele-surface": colors.codeBackground,
  "--pele-surface-alt": colors.fill,
  "--pele-border": colors.tint,
  "--pele-accent": colors.tint,
  "--pele-error": colors.error,
  "--pele-font": FONT_FAMILY,
});

let colors: ReturnType<typeof diagramColors> | null = null;

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
    figure.innerHTML = render(source, { fontFamily: FONT_FAMILY }).svg;
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
