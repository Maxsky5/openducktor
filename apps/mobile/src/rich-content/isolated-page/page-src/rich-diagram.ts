/** The block page for Mermaid diagrams, with math too. Pele makes it larger, so only diagram blocks use it. */
// Installs the built-ins that older WebViews lack, before any other page module runs.
import "./shared/page-globals";
import { startBlockPage } from "./shared/block-page";
import { renderDiagrams, snapshotDiagram } from "./shared/diagrams";

startBlockPage(renderDiagrams, snapshotDiagram);
