// The Builder checks its work in its own browser tab. It calls odt_browser_open, and a new agent
// tab with the Agent badge opens at the end of the right panel and becomes the selected tab. Then
// it reads the page with odt_browser_snapshot, types a query in the search field and presses
// Enter, clicks the Travel notebook, and takes a screenshot. Each call shows as a Browser card in
// the chat, and a sky ring pulses on the page where the agent types or clicks. Sources:
// agent-chat-browser-tool.tsx, browser-tool-summary.ts, browser-agent-marker.tsx, and
// browser-toolbar.tsx in packages/frontend/src, and docs/browser-tabs.md. The markup holds the
// last frame. A phone stage shows one panel at a time, so the visitor opens the panel to watch the
// agent, then goes back to the chat for its answer.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { BrowserSession } from "../../replicas/browser/BrowserSession";
import { Composer } from "../../replicas/studio/Composer";
import { AgentText } from "../../replicas/transcript/AgentText";
import { BrowserToolCard } from "../../replicas/transcript/BrowserToolCard";
import { Thread } from "../../replicas/transcript/Thread";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { AGENT_BADGE, DEV_SERVER, PAGE_TITLE } from "../../sample/browser";
import { signature } from "../../sample/sessions";
import { BUILDER_SESSION } from "../../sample/studio";
import {
  AGENT_BADGE_TIP,
  type BrowserCall,
  CALL_ORDER,
  CALLS,
  CHECK_MESSAGE,
  CHECK_REPLY,
  CHECK_WORKED,
  MESSAGE_TIME,
  PLAN_TEXT,
  SEARCH_QUERY,
} from "./sample";

export function AgentBrowserView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="agent-browser"
      alt={`The session page of a task with its Builder session. The developer asks: "${CHECK_MESSAGE}" The Builder calls the browser tools of OpenDucktor, and each call shows as a Browser card in the chat. The first card, "${CALLS.open.title}", opens a new tab at the end of the right panel. The tab shows the ${AGENT_BADGE} badge, and it loads the ${PAGE_TITLE} app of the dev server at ${DEV_SERVER}. A dot pulses on the tab icon while the agent acts on the page. The Builder reads the page with "${CALLS.snapshot.title}". With "${CALLS.type.title}", a ring pulses on the search field, the field shows "${SEARCH_QUERY}", and the list keeps one note. With "${CALLS.click.title}", a ring pulses on the Travel notebook, and the empty notebook shows. "${CALLS.screenshot.title}" adds a Screenshot button to its card. The Builder answers: "${CHECK_REPLY}" The ${AGENT_BADGE} badge in the toolbar tells: "${AGENT_BADGE_TIP}"`}
    >
      <BrowserSession tabLabel={PAGE_TITLE} notebook="travel" owner="agent">
        <Thread>
          <UserMessage time={MESSAGE_TIME} row="message">
            {CHECK_MESSAGE}
          </UserMessage>
          <AgentText row="plan">
            <p>{PLAN_TEXT}</p>
          </AgentText>
          {CALL_ORDER.map((name) => {
            const call: BrowserCall = CALLS[name];
            return (
              <BrowserToolCard
                key={name}
                title={call.title}
                duration={call.duration}
                time={call.time}
                screenshot={call.screenshot}
                row={name}
              />
            );
          })}
          <AgentText signature={signature(BUILDER_SESSION)} worked={CHECK_WORKED} row="answer">
            <p>{CHECK_REPLY}</p>
          </AgentText>
        </Thread>
        <Composer session={BUILDER_SESSION} />
      </BrowserSession>
    </SceneFrame>
  );
}
