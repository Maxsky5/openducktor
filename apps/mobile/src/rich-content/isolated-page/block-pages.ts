/** The block pages. Run `bun run build:page` in apps/mobile to build their HTML files. */
import { defineIsolatedPage } from "./page-asset";

/** Math blocks. The page has KaTeX but no Mermaid, so it stays small. */
export const RICH_BLOCK_PAGE = defineIsolatedPage(
  "rich-block",
  require("../../../assets/pages/rich-block.html"),
);

/** Blocks with a Mermaid diagram. Mermaid makes this page about seven times larger. */
export const RICH_DIAGRAM_PAGE = defineIsolatedPage(
  "rich-diagram",
  require("../../../assets/pages/rich-diagram.html"),
);
