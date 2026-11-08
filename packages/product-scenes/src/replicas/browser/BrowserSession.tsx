// The session page of a task with a browser tab, cropped to the top bar, the chat column, and the
// right panel. The browser and annotate scenes share it. The children hold the chat column
// content. The right panel has the tool tabs of the task, a New tab with the Open a tab launcher,
// and the browser tab, whose body is Browser.tsx. The browser tab is a shared user tab, or a tab
// that an agent opened. Sources: session-panel.tsx, session-panel-launcher.tsx, and
// session-panel-browser-tab-presentation.ts in packages/frontend/src/features/session-panels.
//
// A phone stage follows use-narrow-window.ts: a session panel fills the page, so the panel is the
// bottom panel, which holds a shell and the browser tab, with Back to workspace before its tabs.
// `data-shows` on the window tells if the phone stage shows the panel or the chat.
import { LayoutGrid, SquareTerminal } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { BROWSER_TASK, DEV_SERVER_SHORT, NEW_TAB_LABEL } from "../../sample/browser";
import { BUILD_FILES, BUILDER_SESSION } from "../../sample/studio";
import { PROMPT, SHELL_LABEL, TERMINAL_ACTIONS } from "../../sample/terminal";
import { Replica } from "../Replica";
import { Pointer } from "../shell/Pointer";
import { ChatColumn } from "../studio/ChatColumn";
import { GitPanel } from "../studio/GitPanel";
import { PanelLauncher } from "../studio/PanelLauncher";
import { PanelTab } from "../studio/PanelTab";
import { PanelTabs } from "../studio/PanelTabs";
import { PanelToggles } from "../studio/PanelToggles";
import { RepoActions } from "../studio/RepoActions";
import { SessionHeader, TaskTitle } from "../studio/SessionHeader";
import { Button } from "../ui/Button";
import { ResizeHandle } from "../ui/ResizeHandle";
import { Tooltip } from "../ui/Tooltip";
import { Browser } from "./Browser";
import { BrowserTab } from "./BrowserTab";
import type { Notebook, PageVersion } from "./FieldnotesPage";
import type { BrowserAccess } from "./model";
import "../studio/BottomPanel.css";
import "./BrowserSession.css";

type BrowserSessionProps = {
  /** The label of the browser tab in the static frame. */
  tabLabel: string;
  notebook: Notebook;
  version?: PageVersion;
  /** Annotate is on in the static frame. */
  annotate?: boolean;
  /** Who opened the browser tab. A user tab is shared with agents in the static frame. */
  owner?: BrowserAccess["owner"];
  /** The chat column content. */
  children: ReactNode;
};

export function BrowserSession({
  tabLabel,
  notebook,
  version = "before",
  annotate = false,
  owner = "user",
  children,
}: BrowserSessionProps): ReactElement {
  const access: BrowserAccess = owner === "agent" ? { owner } : { owner, shared: true };
  return (
    <Replica
      className="app-window bs-window"
      data-runtime={BUILDER_SESSION.runtime}
      data-shows="panel"
    >
      <SessionHeader title={<TaskTitle task={BROWSER_TASK} />}>
        <RepoActions actions={TERMINAL_ACTIONS} />
        <PanelToggles />
      </SessionHeader>
      <div className="bs-area">
        <ChatColumn className="bs-chat">{children}</ChatColumn>
        {/* The separator sits between the chat and the panel, as in session-panel-split.tsx, so
            the panel does not clip its grip. */}
        <ResizeHandle orientation="vertical" className="bs-handle" />
        <div className="bs-panel" data-session-panel="">
          <PanelTabs
            fadeStart
            showEnd
            start={
              <Button variant="ghost" size="xs" className="bs-back" data-back>
                Back to workspace
              </Button>
            }
          >
            <PanelTab id="shell" label={SHELL_LABEL}>
              <SquareTerminal />
            </PanelTab>
            <PanelTab id="new" label={NEW_TAB_LABEL} hidden>
              <LayoutGrid />
            </PanelTab>
            <BrowserTab label={tabLabel} access={access} />
          </PanelTabs>
          <div className="bs-body" data-panel-body="">
            <div className="bs-view" hidden data-tab-view="diffs">
              <GitPanel files={BUILD_FILES} ahead={1} />
            </div>
            <div className="bs-view bp-term" hidden data-tab-view="shell">
              <p className="bp-line">{PROMPT}</p>
            </div>
            <div className="bs-view" hidden data-tab-view="new">
              <PanelLauncher />
            </div>
            <div className="bs-view" data-tab-view="browser">
              <Browser
                address={DEV_SERVER_SHORT}
                notebook={notebook}
                version={version}
                annotate={annotate}
                access={access}
              />
            </div>
          </div>
        </div>
      </div>
      <Tooltip />
      <Pointer />
    </Replica>
  );
}
