/** The terminal page. Run `bun run build:page` in apps/mobile to build its HTML file. */
import { defineIsolatedPage } from "@/rich-content/isolated-page/page-asset";

export const TERMINAL_PAGE = defineIsolatedPage(
  "terminal",
  require("../../../assets/pages/terminal.html"),
);
