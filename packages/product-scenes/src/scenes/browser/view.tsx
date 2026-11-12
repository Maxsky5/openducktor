// A browser tab in the right panel of a task session. The visitor selects New tab at the end of
// the panel tabs, then Browser in the Open a tab launcher. The new tab shows the new tab page, and
// its address bar takes the focus. The visitor types the address of the dev server and presses
// Enter, and the Fieldnotes app loads. Then the visitor turns on Share with agents, and the tab
// shows the Shared badge. Sources: features/session-panels and features/browser in
// packages/frontend/src. The markup holds the last frame. A phone stage follows
// use-narrow-window.ts, so the browser tab opens in the bottom panel.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { BrowserSession } from "../../replicas/browser/BrowserSession";
import { BuilderReply } from "../../replicas/browser/BuilderReply";
import { KeyHud } from "../../replicas/shell/KeyHud";
import { Composer } from "../../replicas/studio/Composer";
import { Thread } from "../../replicas/transcript/Thread";
import { DEV_SERVER, PAGE_TITLE } from "../../sample/browser";
import { BUILDER_SESSION } from "../../sample/studio";
import "./view.css";

export function BrowserView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="browser"
      alt={`The session page of a task after its Builder session, with the Diffs tab in the right panel. The developer selects New tab at the end of the panel tabs, then Browser in the Open a tab launcher. A new browser tab opens with the new tab page, and its address bar takes the focus. The developer types ${DEV_SERVER} and presses Enter, and the ${PAGE_TITLE} app of the dev server loads in the tab. Then the developer selects Share with agents in the toolbar, and the tab shows the Shared badge.`}
    >
      <BrowserSession tabLabel={PAGE_TITLE} notebook="inbox">
        <Thread>
          <BuilderReply />
        </Thread>
        <Composer session={BUILDER_SESSION} />
      </BrowserSession>
      <KeyHud />
    </SceneFrame>
  );
}
