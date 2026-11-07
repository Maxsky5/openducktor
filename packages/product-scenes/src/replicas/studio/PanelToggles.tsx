// The panel toggles of session-view-controls.tsx: the bottom panel and the right panel. An open
// panel shows the close icon, and its toggle is pressed. A scene opens the bottom panel with
// aria-pressed.
import { PanelBottomClose, PanelBottomOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ReactElement } from "react";
import "./PanelToggles.css";

type PanelTogglesProps = { bottom?: boolean; right?: boolean };

export function PanelToggles({ bottom = false, right = true }: PanelTogglesProps): ReactElement {
  return (
    <>
      <span
        className="sh-icon pt-toggle pt-bottom"
        aria-pressed={bottom ? "true" : "false"}
        data-toggle="bottom"
      >
        <PanelBottomOpen className="when-closed" />
        <PanelBottomClose className="when-open" />
      </span>
      <span className="sh-icon pt-toggle" aria-pressed={right ? "true" : "false"}>
        <PanelRightOpen className="when-closed" />
        <PanelRightClose className="when-open" />
      </span>
    </>
  );
}
