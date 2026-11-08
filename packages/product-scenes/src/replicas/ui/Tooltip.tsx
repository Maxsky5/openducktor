// The tooltip of components/ui/tooltip.tsx on the bottom side of its trigger. A scene shows it
// with tip.ts, which places it under the trigger and inside the window.
import type { ReactElement } from "react";
import "./Tooltip.css";

export function Tooltip(): ReactElement {
  return (
    <span className="ui-tip" hidden data-tip="">
      <span data-tip-text="" />
      <i data-tip-arrow="" />
    </span>
  );
}
