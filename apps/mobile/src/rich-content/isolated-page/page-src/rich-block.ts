/** The block page for math. It has no Mermaid, so it stays small and starts fast. */
// Installs the built-ins that older WebViews lack, before any other page module runs.
import "./shared/page-globals";
import { startBlockPage } from "./shared/block-page";

startBlockPage(null);
