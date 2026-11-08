// The body of a browser tab in a session panel, from browser-tab-content.tsx: the Electron toolbar
// of browser-toolbar.tsx, then the page area. A tab with no address shows the new tab page of
// browser-new-tab-view.tsx. A tab with a page shows the Fieldnotes app of the dev server, and the
// overlays of browser-page-overlays.tsx over it: the numbered annotation markers, the element
// picker, the comment box of a selection, and the pulse of browser-agent-marker.tsx where an agent
// clicks or types. A user tab has Share with agents in the toolbar, and a tab that an agent opened
// has the Agent badge in its place. The overlays are hidden in the markup, and browsing.ts and
// agent-marker.ts place them. It fills its parent.
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CodeXml,
  MessageSquareText,
  RotateCw,
  SlidersHorizontal,
  SquareDashedMousePointer,
  X,
} from "lucide-react";
import type { ReactElement } from "react";
import { AGENT_BADGE, BROWSER_ADDRESS_PLACEHOLDER, NEW_TAB_PAGE } from "../../sample/browser";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { FieldnotesPage, type Notebook, type PageVersion } from "./FieldnotesPage";
import type { BrowserAccess } from "./model";
import "./Browser.css";
import "./BrowserAgent.css";

type BrowserProps = {
  /** `blank` is a new tab with no address, and `page` shows the Fieldnotes app. */
  state?: "blank" | "page";
  /** The page address without its scheme, as the address bar shows it without the focus. */
  address?: string;
  notebook?: Notebook;
  version?: PageVersion;
  /** Annotate is on. */
  annotate?: boolean;
  access: BrowserAccess;
};

const pressed = (on: boolean): "true" | "false" => (on ? "true" : "false");

function CommentBox(): ReactElement {
  return (
    <div className="bw-comment" hidden data-bw-comment="">
      <div className="bw-comment-form">
        <p className="bw-comment-label" data-bw-comment-label="" />
        <div className="bw-textarea">
          <div
            className="bw-comment-text typed"
            data-bw-comment-text=""
            data-placeholder="Tell the agent what to change"
          />
          <svg className="bw-resizer" viewBox="0 0 8 8" aria-hidden="true">
            <path d="M7.5 1.5l-6 6M7.5 5l-2.5 2.5" />
          </svg>
        </div>
        <div className="bw-comment-footer">
          <span className="bw-comment-switch">
            <Switch checked />
            Screenshot
          </span>
          <span className="bw-comment-buttons">
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
            <Button size="sm" data-bw-save data-disabled>
              Save
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

export function Browser({
  state = "page",
  address = "localhost:5173",
  notebook = "inbox",
  version = "before",
  annotate = false,
  access,
}: BrowserProps): ReactElement {
  return (
    <div className="bw" data-bw="" data-state={state}>
      <div className="bw-toolbar">
        <div className="bw-toolbar-row">
          <span className="bw-tool" data-bw-tool="back" data-disabled="">
            <ArrowLeft />
          </span>
          <span className="bw-tool" data-bw-tool="forward" data-disabled="">
            <ArrowRight />
          </span>
          <span className="bw-tool" data-bw-tool="reload">
            <RotateCw className="bw-reload-icon" />
            <X className="bw-stop-icon" />
          </span>
          <span className="bw-tool" data-popover="" data-bw-tool="site">
            <SlidersHorizontal />
          </span>
          <span className="bw-address" data-bw-address-box="">
            <span
              className="bw-address-text typed"
              data-bw-address=""
              data-placeholder={BROWSER_ADDRESS_PLACEHOLDER}
            >
              {state === "blank" ? "" : address}
            </span>
          </span>
          <span className="bw-tool" data-bw-tool="annotate" aria-pressed={pressed(annotate)}>
            <SquareDashedMousePointer />
          </span>
          <span className="bw-tool" data-popover="" data-bw-tool="annotations">
            <MessageSquareText />
            <span className="bw-count" data-bw-count="" hidden />
          </span>
          {access.owner === "agent" ? (
            <span className="bw-agent-badge" data-bw-agent-badge="">
              <Bot />
              {AGENT_BADGE}
            </span>
          ) : (
            <span className="bw-tool" data-bw-tool="share" aria-pressed={pressed(access.shared)}>
              <Bot />
            </span>
          )}
          <span className="bw-tool" data-bw-tool="devtools" aria-pressed="false">
            <CodeXml />
          </span>
        </div>
      </div>
      <div className="bw-page" data-bw-page="">
        <FieldnotesPage notebook={notebook} version={version} />
        <section className="bw-newtab">
          <header>
            <h2>{NEW_TAB_PAGE.title}</h2>
            <p>
              Type a web address above, such as <code>localhost:3000</code>.
            </p>
          </header>
          <p className="bw-newtab-empty">{NEW_TAB_PAGE.empty}</p>
        </section>
        <div className="bw-overlay">
          <div className="bw-layer">
            <span className="bw-marker" data-bw-marker="1" hidden>
              1
            </span>
            <span className="bw-marker" data-bw-marker="2" hidden>
              2
            </span>
          </div>
          <div className="bw-layer">
            <span className="bw-agent-marker" data-bw-agent-marker="" hidden />
          </div>
          <div className="bw-layer">
            <div className="bw-selected" data-bw-selected="" hidden />
            <div className="bw-target" data-bw-target="" hidden>
              <span className="bw-target-label" data-bw-target-label="" />
            </div>
          </div>
          <CommentBox />
        </div>
      </div>
    </div>
  );
}
