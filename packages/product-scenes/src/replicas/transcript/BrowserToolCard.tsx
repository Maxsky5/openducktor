// One odt_browser_* call in the transcript, from agent-chat-browser-tool.tsx and
// agent-chat-action-tool-card.tsx: a card with the Globe icon, the "Browser" label, the title of
// the action, the Screenshot button of a call that saved a screenshot, the timing, and the chevron
// of the closed Input and Output sections. A running call shows three pulsing bars in place of its
// duration, as agent-chat-tool-message-timing.tsx does, and has no Screenshot button yet. A scene
// sets `data-running` on the `data-tool` summary.
import { ChevronDown, Globe, ImageIcon } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import "./BrowserToolCard.css";

type BrowserToolCardProps = {
  /** The title of the action: browserToolTitle in browser-tool-summary.ts. */
  title: string;
  duration: string;
  time: string;
  /** The call saved a screenshot. */
  screenshot?: boolean;
  running?: boolean;
  row?: string;
};

export function BrowserToolCard({
  title,
  duration,
  time,
  screenshot = false,
  running = false,
  row,
}: BrowserToolCardProps): ReactElement {
  return (
    <div className="st-action-row" data-row={row}>
      <div className="st-action">
        <div className="st-action-summary" data-tool="" data-running={flag(running)}>
          <Globe className="st-action-icon" />
          <span className="st-action-label">Browser</span>
          <p className="st-action-title">{title}</p>
          {screenshot && (
            <span className="st-action-shot" data-shot="">
              <ImageIcon className="i12" />
              Screenshot
            </span>
          )}
          <span className="st-action-time">
            <span className="st-action-running">
              <span />
              <span />
              <span />
            </span>
            <span className="st-action-duration">{duration}</span>
            <span>{time}</span>
          </span>
          <ChevronDown className="st-action-chevron" />
        </div>
      </div>
    </div>
  );
}
