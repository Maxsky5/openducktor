// The mobile app queues and steers messages while the Builder of the search shortcut task works.
// The visitor types a message, and Send puts it in the Message Queue on the composer. A tap opens
// the queued message, and Steer now gives it to the running turn: the transcript shows it as
// Unread until the agent reads it, and the agent answers. The visitor types a second message and
// taps the zap button next to Send, which steers it at once. Sources: session-composer.tsx,
// message-queue-panel.tsx, and queue-item-state.ts in apps/mobile/src/features/composer, and
// user-message-row.tsx in apps/mobile/src/features/session/transcript/rows. The markup holds the
// last frame. A phone stage shows only the phone.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { QueuePanel } from "../../replicas/mobile/MessageQueue";
import { MobileStage } from "../../replicas/mobile/MobileStage";
import { PhoneFrame } from "../../replicas/mobile/PhoneFrame";
import { SessionScreen } from "../../replicas/mobile/SessionScreen";
import { Touch } from "../../replicas/mobile/Touch";
import { AgentMessage, ToolRow, UserBubble } from "../../replicas/mobile/TranscriptRows";
import { UserMessageRow } from "../../replicas/mobile/UserMessageRow";
import { BUILDER_PLAN, BUILDER_RAIL } from "../../sample/mobile";
import { BUILDER_SESSION, KICKOFF } from "../../sample/studio";
import { TASKS } from "../../sample/tasks";
import { ANSWER, MESSAGES, READY, STEPS, TOOLS } from "./sample";
import "./view.css";

export function MobileSteerView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="mobile-steer"
      alt={`The OpenDucktor mobile app on a phone. The Builder session of the task "${TASKS.k3x9.title}" is open, and the Builder runs ${TOOLS.test.summary}. A light runs around the composer, and the composer shows Stop. The user types "${MESSAGES.queued.text}" and taps Send. The message goes to a dashed card on top of the composer with the label Queued. The user taps the card. It opens with the whole message and three icon buttons: a zap that steers the message now, a pencil that edits it, and a trash can that removes it. The user taps the zap button. The card shows Steering… and goes. The message shows in the transcript with a dashed violet outline and the Unread pill. The agent reads it, the pill goes, and the agent answers: The hook already takes Ctrl+K on Windows and Linux. I add a test for each platform. Then the user types "${MESSAGES.steered.text}". A zap button shows next to Stop and Send. The user taps it, and the message goes into the running turn at once. The agent reads it and runs ${TOOLS.keymapTests.summary}. Next to the phone, a list of four steps highlights the current step.`}
    >
      <MobileStage
        steps={STEPS}
        phone={
          <PhoneFrame overlay={<Touch />}>
            <SessionScreen
              id="session"
              title={TASKS.k3x9.title}
              session={BUILDER_SESSION}
              steps={BUILDER_RAIL}
              role="build"
              activity="working"
              rows={
                <>
                  <UserBubble text={KICKOFF.build} />
                  <ToolRow tools={TOOLS} id="guide" />
                  <ToolRow tools={TOOLS} id="keymap" />
                  <ToolRow tools={TOOLS} id="list" />
                  <ToolRow tools={TOOLS} id="search" />
                  <ToolRow tools={TOOLS} id="shell" />
                  <ToolRow tools={TOOLS} id="dialog" />
                  <AgentMessage paragraphs={[BUILDER_PLAN]} />
                  <AgentMessage paragraphs={[READY]} />
                  <ToolRow tools={TOOLS} id="test" />
                  <UserMessageRow {...MESSAGES.queued} row="queued" />
                  <AgentMessage paragraphs={[ANSWER]} row="answer" />
                  <ToolRow tools={TOOLS} id="readTest" />
                  <UserMessageRow {...MESSAGES.steered} row="steered" />
                  <ToolRow tools={TOOLS} id="keymapTests" />
                </>
              }
              composer={{
                queue: <QueuePanel text={MESSAGES.queued.text} hidden />,
                secondary: "steer",
              }}
            />
          </PhoneFrame>
        }
      />
    </SceneFrame>
  );
}
