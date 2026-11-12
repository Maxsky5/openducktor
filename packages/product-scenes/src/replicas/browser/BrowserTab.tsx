// The panel tab of a browser tab, from session-panel.tsx, session-panel-tab-icon.tsx, and
// session-panel-browser-tab-presentation.ts: the page favicon, or the Globe icon before the page
// gives one, the label, the badge, and the close button. A user tab that agents can use shows the
// Shared badge, and a tab that an agent opened shows the Agent badge. The label is the page title,
// the host before the page has a title, or "Blank page". It uses the classes of PanelTab.tsx.
// `data-favicon` switches the Globe icon to the favicon, and `data-shared` shows the Shared badge.
// `data-agent-active` shows the pulsing dot over the icon while an agent acts on the page.
import { Globe, X } from "lucide-react";
import type { ReactElement } from "react";
import { AGENT_BADGE, SHARED_BADGE } from "../../sample/browser";
import { flag } from "../flag";
import type { BrowserAccess } from "./model";
import "../studio/PanelTab.css";
import "./BrowserTab.css";

type BrowserTabProps = {
  label: string;
  active?: boolean;
  favicon?: boolean;
  access: BrowserAccess;
};

export function BrowserTab({
  label,
  active = true,
  favicon = true,
  access,
}: BrowserTabProps): ReactElement {
  return (
    <span
      className="ptab bw-tab"
      data-ptab="browser"
      data-active={flag(active)}
      data-favicon={flag(favicon)}
      data-shared={flag(access.owner === "user" && access.shared)}
      data-owner={access.owner}
    >
      <span className="ptab-icon">
        <Globe className="bw-tab-globe" />
        <svg className="bw-tab-favicon" viewBox="0 0 24 24" aria-hidden="true">
          <rect width="24" height="24" rx="5" fill="#5100ff" />
          <path
            d="M8.6 5.75h5.15l3.5 3.5v8.5a1.5 1.5 0 0 1-1.5 1.5H8.6a1.5 1.5 0 0 1-1.5-1.5V7.25a1.5 1.5 0 0 1 1.5-1.5z"
            fill="#fff"
          />
        </svg>
        <span className="bw-tab-mark" />
      </span>
      <span className="ptab-label" data-bw-tab-label="">
        {label}
      </span>
      <span className="bw-tab-badge" data-bw-badge="">
        {access.owner === "agent" ? AGENT_BADGE : SHARED_BADGE}
      </span>
      <span className="ptab-close">
        <X />
      </span>
    </span>
  );
}
