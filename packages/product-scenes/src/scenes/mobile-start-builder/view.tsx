// The mobile app starts the Builder of a task from the board. The Tasks tab shows Backlog, and
// the visitor swipes to Ready for Dev. The card of the search shortcut task offers Start Builder.
// A tap opens the Start Builder session sheet with the target branch, the model, the effort, and
// the speed. Start session shows the startup progress in the sheet while the host creates the
// task worktree, sets its upstream, and starts the session. Then the sheet closes and the session
// opens, where the workflow rail shows the Builder at work and the first tool calls come in. Sources: task-board-screen.tsx,
// board-pager.tsx, board-lane-switcher.tsx, and task-card.tsx in apps/mobile/src/features/tasks/
// board, session-start-sheet.tsx and session-start-form.tsx in
// apps/mobile/src/features/workflow/start-session, startup-trace.tsx in
// apps/mobile/src/features/session-startup, and session-view.tsx in
// apps/mobile/src/features/session. The markup holds the open start sheet over
// the board on Ready for Dev, so the static frame shows the choices of the start. A phone stage
// shows only the phone.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { MobileStage } from "../../replicas/mobile/MobileStage";
import { PhoneFrame } from "../../replicas/mobile/PhoneFrame";
import { SessionScreen } from "../../replicas/mobile/SessionScreen";
import { StartSessionSheet } from "../../replicas/mobile/StartSessionSheet";
import { StartupTrace } from "../../replicas/mobile/StartupTrace";
import { TaskBoard } from "../../replicas/mobile/TaskBoard";
import { Touch } from "../../replicas/mobile/Touch";
import { ToolRun } from "../../replicas/mobile/ToolRun";
import { AgentMessage } from "../../replicas/mobile/TranscriptRows";
import { UserMessageRow } from "../../replicas/mobile/UserMessageRow";
import { BUILD_KICKOFF_TIME, BUILDER_RAIL } from "../../sample/mobile";
import { BUILDER_SESSION, KICKOFF } from "../../sample/studio";
import { TASKS } from "../../sample/tasks";
import {
  CARDS,
  COUNTS,
  EFFORTS,
  PLAN,
  READY_LANE,
  RUNS,
  SHEET_STEP,
  STARTUP_ORIGIN,
  STARTUP_STEPS,
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
      alt={`The OpenDucktor mobile app on a phone. The Tasks tab shows the fieldnotes board one lane at a time. Under the header, a rail lists the lanes with their task counts: Backlog 4, Spec ready 1, Ready for dev 2, In progress 2, Blocked 0, AI review 1, Human review 1, and Done 0. A pill marks the shown lane, and the lane title under the rail reads Backlog, 4 tasks, next to Filters. Each Backlog card shows its title, its type, its priority, its ID, Start Spec, and a chevron. The user swipes left twice. The pages, the pill, and the lane title move with the finger, through Spec Ready to Ready for Dev. The card "${TASKS.k3x9.title}" shows the violet button Start Builder. The user taps it. The sheet Start Builder session opens: Start a new session, Target branch ${TARGET}, Runtime and model GPT-6-Astra on Codex, Effort ${BUILDER_SESSION.effort}, Speed Standard, the switch Goal mode, and the switch Customize first message. Both switches are off. Run in background, Cancel, and Start session are at the bottom. The user taps Start session. The button shows its progress, and Run in background becomes Continue in background. Then the sheet shows Starting session, ${STARTUP_ORIGIN}, and the steps Create task worktree, Set branch upstream, and Start session, which complete one after the other, with Continue in background under them. The sheet closes and the Builder session opens from the right. The workflow rail shows Spec and Planner as done and the Builder at work. The first message of the Builder shows. The Builder reads AGENTS.md and the app shell and searches the code with shell commands, which show one under the other in a tool run. Then it says that it writes the hook first, and the tool run folds to one line. Next to the phone, a list of five steps highlights the current step.`}
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
                  <UserMessageRow text={KICKOFF.build} time={BUILD_KICKOFF_TIME} />
                  <ToolRun tools={TOOLS} calls={RUNS.reading} row="reading" folded />
                  <AgentMessage paragraphs={[PLAN]} row="plan" />
                  <ToolRun tools={TOOLS} calls={RUNS.listing} row="listing" running="list" />
                </>
              }
            />
            <StartSessionSheet
              role="Builder"
              session={BUILDER_SESSION}
              target={TARGET}
              efforts={EFFORTS}
              goal
              progress={<StartupTrace origin={STARTUP_ORIGIN} steps={STARTUP_STEPS} />}
            />
          </PhoneFrame>
        }
      />
    </SceneFrame>
  );
}
