/**
 * The vertical margins of Markdown blocks, from the desktop `prose` classes of
 * `markdown-renderer-components.tsx`. The margins of two blocks collapse, as in CSS, so the space
 * between them is the larger margin. The first block has no space above it.
 */
import type { RootContent } from "mdast";
import type { MarkdownVariant } from "./markdown-context";
import type { MarkdownBlock } from "./markdown-document";

type Margins = { readonly top: number; readonly bottom: number };

const NONE: Margins = { top: 0, bottom: 0 };

const margins = (top: number, bottom = top): Margins => ({ top, bottom });

/**
 * `document`: `prose` with `text-sm`, at a 15-point base. Headings keep the `prose` em margins;
 * `prose-p:my-2`, `prose-ul:my-2`, `prose-pre:my-3`, `prose-table:my-3`, and `prose-hr:my-4`
 * set the rest. A block quote keeps its 1.6em margin.
 */
const DOCUMENT_MARGINS = {
  paragraph: margins(8),
  list: margins(8),
  code: margins(12),
  table: margins(12),
  thematicBreak: margins(16),
  blockquote: margins(24),
  math: margins(12),
  heading1: margins(0, 30),
  heading2: margins(45, 22),
  heading3: margins(30, 11),
  heading4: margins(22, 8),
  other: margins(8),
} as const satisfies Record<string, Margins>;

/**
 * `compact`: `prose-sm` with `prose-headings:my-1`, `prose-p:my-1`, `prose-ul:my-1`, and
 * `prose-pre:my-2`, at a 14-point base.
 */
const COMPACT_MARGINS = {
  paragraph: margins(4),
  list: margins(4),
  code: margins(8),
  table: margins(8),
  thematicBreak: margins(16),
  blockquote: margins(8),
  math: margins(8),
  heading1: margins(4),
  heading2: margins(4),
  heading3: margins(4),
  heading4: margins(4),
  other: margins(4),
} as const satisfies Record<string, Margins>;

const blockMargins = (node: RootContent, variant: MarkdownVariant): Margins => {
  const table = variant === "compact" ? COMPACT_MARGINS : DOCUMENT_MARGINS;
  switch (node.type) {
    case "paragraph":
    case "html":
      return table.paragraph;
    case "list":
      return table.list;
    case "code":
      return table.code;
    case "math":
      return table.math;
    case "table":
      return table.table;
    case "thematicBreak":
      return table.thematicBreak;
    case "blockquote":
      return table.blockquote;
    case "heading":
      switch (node.depth) {
        case 1:
          return table.heading1;
        case 2:
          return table.heading2;
        case 3:
          return table.heading3;
        case 4:
          return table.heading4;
        default:
          // `prose` sets no margin on h5 and h6.
          return variant === "compact" ? table.heading4 : NONE;
      }
    case "definition":
      return NONE;
    default:
      return table.other;
  }
};

/** The space above `block`: the collapsed margin between it and the block before it. */
export const markdownBlockGap = (
  previous: MarkdownBlock | undefined,
  block: MarkdownBlock,
  variant: MarkdownVariant,
): number => {
  if (previous === undefined) return 0;
  return Math.max(
    blockMargins(previous.node, variant).bottom,
    blockMargins(block.node, variant).top,
  );
};
