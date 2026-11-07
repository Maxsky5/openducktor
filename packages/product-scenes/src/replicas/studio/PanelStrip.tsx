// The tab strip of a session panel in session-panel.tsx: the tabs, then the New tab button right
// after the last tab. A scene shows a hidden tab, or hides one.
import { Plus } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import "./PanelStrip.css";

type PanelStripProps = {
  /** The scene hook of the strip, such as right or bottom. */
  panel: string;
  children?: ReactNode;
};

export function PanelStrip({ panel, children }: PanelStripProps): ReactElement {
  return (
    <div className="pstrip" data-strip={panel}>
      {children}
      <span className="pstrip-add">
        <Plus />
      </span>
    </div>
  );
}
