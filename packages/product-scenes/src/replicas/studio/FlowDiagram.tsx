// A Mermaid flowchart of a document, as markdown-diagram.ts shows it: Pele draws it in the app theme
// of @openducktor/theme/diagrams.css on the diagram canvas of markdown.css. The shapes and the
// positions are the drawing of Pele with the options of the app, which measures the labels in
// Space Grotesk. The preview button shows only on hover, so this copy leaves it out.
import type { ReactElement } from "react";
import "./FlowDiagram.css";

export function FlowDiagram(): ReactElement {
  return (
    <div className="flow">
      <svg viewBox="0 0 240 291" aria-hidden="true">
        <path className="flow-edge" d="M55.57 53V116" />
        <path className="flow-edge" d="M187.13 53V116" />
        <path className="flow-edge" d="M121.35 168V231" />
        <path className="flow-head" d="M55.57 123L52.21 115H58.93Z" />
        <path className="flow-head" d="M187.13 123L183.77 115H190.49Z" />
        <path className="flow-head" d="M121.35 238L117.99 230H124.71Z" />
        <rect className="flow-label" x="29.52" y="79" width="52.11" height="18" />
        <text className="flow-label-text" x="55.57" y="92.2">
          mounts
        </text>
        <rect className="flow-label" x="156.84" y="79" width="60.58" height="18" />
        <text className="flow-label-text" x="187.13" y="92.2">
          keydown
        </text>
        <rect className="flow-label" x="82.45" y="194" width="77.8" height="18" />
        <text className="flow-label-text" x="121.35" y="207.2">
          openSearch
        </text>
        <rect className="flow-node" x="8" y="8" width="95.15" height="45" />
        <text className="flow-text" x="55.57" y="35.4">
          AppShell
        </text>
        <rect className="flow-node" x="37.44" y="123" width="167.81" height="45" />
        <text className="flow-text" x="121.35" y="150.4">
          useSearchShortcut
        </text>
        <rect className="flow-node" x="143.15" y="8" width="87.96" height="45" />
        <text className="flow-text" x="187.13" y="35.4">
          window
        </text>
        <rect className="flow-node" x="58.98" y="238" width="124.73" height="45" />
        <text className="flow-text" x="121.35" y="265.4">
          SearchDialog
        </text>
      </svg>
    </div>
  );
}
