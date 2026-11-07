// A tab of a session panel in session-panel.tsx: the icon of its kind, its label, and the close
// button, which shows on the active tab. The children hold the icon.
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import "./PanelTab.css";

type PanelTabProps = {
  /** The scene hook of the tab. */
  id: string;
  label: string;
  active?: boolean;
  hidden?: boolean;
  children?: ReactNode;
};

export function PanelTab({
  id,
  label,
  active = false,
  hidden = false,
  children,
}: PanelTabProps): ReactElement {
  return (
    <span className="ptab" data-active={flag(active)} hidden={hidden} data-ptab={id}>
      <span className="ptab-icon">{children}</span>
      <span className="ptab-label">{label}</span>
      <span className="ptab-close">
        <X />
      </span>
    </span>
  );
}
