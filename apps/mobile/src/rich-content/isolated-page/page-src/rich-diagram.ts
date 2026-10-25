/** The block page for Mermaid diagrams, with math too. Mermaid makes it large, so only diagram blocks use it. */
// Installs the built-ins that older WebViews lack, before any other page module runs.
import "./shared/page-globals";
import { startBlockPage } from "./shared/block-page";
import { renderMermaidDiagrams, snapshotDiagram } from "./shared/mermaid-diagrams";

startBlockPage(renderMermaidDiagrams, snapshotDiagram);
