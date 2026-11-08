// The mobile app starts the Builder of a task from the board. The Tasks tab shows Backlog, and
// the visitor swipes to Ready for Dev. The card of the search shortcut task offers Start Builder.
// A tap opens the Start Builder session sheet with the target branch, the model, the effort, and
// the speed. Start session closes the sheet and opens the session, where the workflow rail shows
// the Builder at work and the first tool calls come in. Sources: task-board-screen.tsx,
// board-pager.tsx, board-lane-switcher.tsx, and task-card.tsx in apps/mobile/src/features/tasks/
// board, session-start-form.tsx in apps/mobile/src/features/workflow/start-session, and
// session-view.tsx in apps/mobile/src/features/session. The markup holds the open start sheet over
// the board on Ready for Dev, so the static frame shows the choices of the start. A phone stage
// shows only the phone.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { MobileStage } from "../../replicas/mobile/MobileStage";
import { PhoneFrame } from "../../replicas/mobile/PhoneFrame";
import { SessionScreen } from "../../replicas/mobile/SessionScreen";
import { StartSessionSheet } from "../../replicas/mobile/StartSessionSheet";
import { TaskBoard } from "../../replicas/mobile/TaskBoard";
import { Touch } from "../../replicas/mobile/Touch";
import { AgentMessage, ToolRow, UserBubble } from "../../replicas/mobile/TranscriptRows";
import { BUILDER_RAIL } from "../../sample/mobile";
import { BUILDER_SESSION, KICKOFF } from "../../sample/studio";
import { TASKS } from "../../sample/tasks";
import {
  CARDS,
  COUNTS,
  EFFORTS,
  PLAN,
  READY_LANE,
  SHEET_STEP,
  STEPS,
  TARGET,
  TOOLS,
} from "./sample";
import "./view.css";

export function MobileStartBuilderView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="mobile-start-builder"
      alt={`The OpenDucktor mobile app on a phone. The Tasks tab shows the fieldnotes board one lane at a time. Under the header, a rail lists the lanes with their task counts: Backlog 4, Spec ready 1, Ready for dev 2, In progress 2, Blocked 0, AI review 1, Human review 1, and Done 0. A pill marks the shown lane, and the lane title under the rail reads Backlog, 4 tasks, next to Filters. Each Backlog card shows its title, its type, its priority, its ID, Start Spec, and a chevron. The user swipes left twice. The pages, the pill, and the lane title move with the finger, through Spec Ready to Ready for Dev. The card "${TASKS.k3x9.title}" shows the violet button Start Builder. The user taps it. The sheet Start Builder session opens: Start a new session, Target branch ${TARGET}, Runtime and model GPT-6-Astra on Codex, Effort ${BUILDER_SESSION.effort}, Speed Standard, the switch Goal mode, and the switch Customize first message. Both switches are off. Run in background, Cancel, and Start session are at the bottom. The user taps Start session. The sheet closes and the Builder session opens. The workflow rail shows Spec and Planner as done and the Builder at work. The first message of the Builder shows, and the Builder reads AGENTS.md and the app shell, searches the code, and says that it writes the hook first. Next to the phone, a list of five steps highlights the current step.`}
    >
      <MobileStage
        steps={STEPS}
        current={SHEET_STEP}
        phone={
          <PhoneFrame overlay={<Touch />}>
            <TaskBoard counts={COUNTS} cards={CARDS} selected={READY_LANE} />
            <SessionScreen
              id="session"
              hidden
              title={TASKS.k3x9.title}
              session={BUILDER_SESSION}
              steps={BUILDER_RAIL}
              role="build"
              activity="working"
              rows={
                <>
                  <UserBubble text={KICKOFF.build} />
                  <ToolRow tools={TOOLS} id="guide" />
                  <ToolRow tools={TOOLS} id="shell" />
                  <ToolRow tools={TOOLS} id="search" />
                  <AgentMessage paragraphs={[PLAN]} row="plan" />
                  <ToolRow tools={TOOLS} id="list" />
                </>
              }
            />
            <StartSessionSheet
              role="Builder"
              session={BUILDER_SESSION}
              target={TARGET}
              efforts={EFFORTS}
              goal
            />
          </PhoneFrame>
        }
      />
    </SceneFrame>
  );
}
