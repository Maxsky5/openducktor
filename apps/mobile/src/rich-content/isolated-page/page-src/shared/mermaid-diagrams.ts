/** Mermaid diagrams for the diagram page. Mermaid runs with `securityLevel: "strict"`. */
// Only the diagram page loads this module, and the page draws diagrams as soon as it starts.
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import
import mermaid from "mermaid";
import { LruCache } from "../../../lru-cache";
import { type BlockRenderMessage, MAX_SNAPSHOT_LENGTH } from "../../block-page-messages";
import type { BlockSnapshotter, DiagramRenderer } from "./block-page";
import { drawElementPng, pageDocument } from "./page-runtime";

const diagrams = new LruCache<string, string>(32);
let initializedStyle: string | null = null;
let diagramCount = 0;

// Diagrams keep the system font, unlike the text of the page. The diagram picture draws the SVG
// as an image, which cannot use the fonts of the page.
const FONT_FAMILY = "-apple-system, system-ui, sans-serif";

/**
 * The Mermaid `base` theme in the app colors: nodes on the code background with tint borders,
 * secondary lines, and no gradients or shadows. Only the `base` theme reads theme variables.
 */
const themeVariables = ({ theme, colors }: BlockRenderMessage) => ({
  darkMode: theme === "dark",
  background: colors.background,
  fontFamily: FONT_FAMILY,
  useGradient: false,
  dropShadow: "",
  primaryColor: colors.codeBackground,
  primaryTextColor: colors.label,
  primaryBorderColor: colors.tint,
  secondaryColor: colors.codeBackground,
  secondaryTextColor: colors.label,
  secondaryBorderColor: colors.separator,
  tertiaryColor: colors.fill,
  tertiaryTextColor: colors.label,
  tertiaryBorderColor: colors.separator,
  lineColor: colors.secondaryLabel,
  textColor: colors.label,
  titleColor: colors.label,
  edgeLabelBackground: colors.background,
  clusterBkg: colors.fill,
  clusterBorder: colors.separator,
  noteBkgColor: colors.fill,
  noteTextColor: colors.label,
  noteBorderColor: colors.separator,
  actorBkg: colors.codeBackground,
  actorBorder: colors.tint,
  actorTextColor: colors.label,
  actorLineColor: colors.separator,
  signalColor: colors.label,
  signalTextColor: colors.label,
});

export const renderMermaidDiagrams: DiagramRenderer = async (root, message, isCurrent) => {
  const blocks = Array.from(root.querySelectorAll("pre > code.language-mermaid"));
  if (blocks.length === 0) return true;
  const variables = themeVariables(message);
  const style = JSON.stringify(variables);
  if (initializedStyle !== style) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: variables,
      fontFamily: FONT_FAMILY,
    });
    initializedStyle = style;
  }
  for (const code of blocks) {
    const source = code.textContent ?? "";
    const key = `${style}\n${source}`;
    let svg = diagrams.get(key);
    if (svg === undefined) {
      diagramCount += 1;
      svg = (await mermaid.render(`odt-diagram-${diagramCount}`, source)).svg;
      diagrams.set(key, svg);
    }
    if (!isCurrent()) return false;
    const figure = pageDocument.createElement("div");
    figure.className = "diagram";
    // Mermaid sanitizes the SVG in strict mode, and the page policy runs only the page script.
    // react-doctor-disable-next-line react-doctor/dangerous-html-sink
    figure.innerHTML = svg;
    code.parentElement?.replaceWith(figure);
  }
  return true;
};

/**
 * A PNG of a block that is one diagram, so the app shows the same picture again without running
 * Mermaid. The picture is only a cache of the drawn block. When the page cannot draw it, the block
 * has no picture, and the app renders it again the next time: WebKit keeps the canvas closed
 * after it draws an SVG with HTML labels, gives no 2D context for a canvas over its area limit,
 * and can fail to decode a large SVG. A PNG over the message limit also gives no picture.
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
