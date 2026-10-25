/** Layout facts of Markdown nodes that native views need. Each view memoizes them by node. */
import type { ListItem, Nodes, PhrasingContent, Table } from "mdast";
import type { MarkdownDefinitions } from "./markdown-document";

export const plainText = (node: Nodes): string => {
  if ("value" in node) return node.value;
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if ("children" in node) return node.children.map(plainText).join("");
  return "";
};

export type ListItemMarker =
  | { kind: "checkbox"; checked: boolean }
  | { kind: "text"; text: string };

/**
 * The mark before a list item: the bullet or the number, or only the checkbox of a task item, as
 * GitHub and the desktop show it. `position` is the number of an ordered item.
 */
export const listItemMarker = (
  item: ListItem,
  ordered: boolean,
  position: number,
): ListItemMarker => {
  if (item.checked === true || item.checked === false) {
    return { kind: "checkbox", checked: item.checked };
  }
  return { kind: "text", text: ordered ? `${position}.` : "•" };
};

const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 260;
/** The desktop `prose` cell padding: 0.5714286em on each side, 8 points. */
const CELL_PADDING = 16;

/**
 * Column widths in points for a table that scrolls sideways. Each column fits its longest cell,
 * within limits, so all rows line up. Long cells wrap inside the limit.
 */
export const tableColumnWidths = (table: Table, characterWidth: number): number[] => {
  const columns = Math.max(
    table.align?.length ?? 0,
    ...table.children.map((row) => row.children.length),
  );
  return Array.from({ length: columns }, (_, column) => {
    const longest = Math.max(
      0,
      ...table.children.map((row) => {
        const cell = row.children[column];
        return cell === undefined ? 0 : plainText(cell).length;
      }),
    );
    const width = Math.ceil(longest * characterWidth) + CELL_PADDING;
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
  });
};

export type ParagraphSegment =
  | { readonly kind: "text"; readonly nodes: readonly PhrasingContent[] }
  | { readonly kind: "image"; readonly url: string; readonly alt: string };

/**
 * Splits a paragraph at its images, so each image shows as a block at the full width. Space
 * between two images does not make a text segment.
 */
export const paragraphSegments = (
  children: readonly PhrasingContent[],
  definitions: MarkdownDefinitions,
): ParagraphSegment[] => {
  const segments: ParagraphSegment[] = [];
  let run: PhrasingContent[] = [];
  const endRun = (): void => {
    if (run.some((node) => node.type !== "text" || node.value.trim().length > 0)) {
      segments.push({ kind: "text", nodes: run });
    }
    run = [];
  };
  for (const node of children) {
    const url =
      node.type === "image"
        ? node.url
        : node.type === "imageReference"
          ? definitions.get(node.identifier)?.url
          : undefined;
    if (url === undefined || (node.type !== "image" && node.type !== "imageReference")) {
      run.push(node);
      continue;
    }
    endRun();
    segments.push({ kind: "image", url, alt: node.alt ?? "" });
  }
  endRun();
  return segments;
};
