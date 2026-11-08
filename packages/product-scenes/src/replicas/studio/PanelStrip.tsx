// The tab strip of a session panel in session-panel.tsx: the tabs, then the New tab button right
// after the last tab. The end slot holds the controls after it, such as the restart button of a
// terminal. A scene shows a hidden tab, or hides one. A strip that has tabs out of view at its
// start fades its start edge, as the scroll area of the strip does. A strip that scrolls to a
// selected tab at its end shows its end when the tabs overflow. A scene shows that a dragged tab
// can land on the strip with data-drop="accepted".
import { Plus } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import "./PanelStrip.css";

type PanelStripProps = {
  /** The scene hook of the strip, such as right or bottom. */
  panel: string;
  /** Tabs are out of view at the start of the strip. */
  fadeStart?: boolean;
  /** The strip shows its end when its tabs overflow, as when it scrolls to a tab at its end. */
  showEnd?: boolean;
  /** The controls after the New tab button. */
  end?: ReactNode;
  children?: ReactNode;
};

export function PanelStrip({
  panel,
  fadeStart = false,
  showEnd = false,
  end,
  children,
}: PanelStripProps): ReactElement {
  return (
    <div
      className="pstrip"
      data-strip={panel}
      data-fade-start={flag(fadeStart)}
      data-show-end={flag(showEnd)}
    >
      {children}
      <span className="pstrip-add" data-strip-add="">
        <Plus />
      </span>
      {end}
    </div>
  );
}
