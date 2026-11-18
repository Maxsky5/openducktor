// The mobile app answers a permission request. The Sessions tab shows the Builder of the search
// shortcut task in Needs you, and its tab shows the Needs you badge. The visitor opens the session,
// reads the request, and approves it once. The card goes, and the Builder runs the tests and
// continues. Back on the Sessions tab, the session is in Running and the badge is gone. Sources:
// sessions-screen.tsx and session-row.tsx in apps/mobile/src/features/sessions, session-view.tsx
// and permission-prompt-card.tsx in apps/mobile/src/features/session. The markup holds the last
// frame. A phone stage shows only the phone.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { MobileStage } from "../../replicas/mobile/MobileStage";
import { PermissionCard } from "../../replicas/mobile/PermissionCard";
import { PhoneFrame } from "../../replicas/mobile/PhoneFrame";
import { SessionScreen } from "../../replicas/mobile/SessionScreen";
import { SessionsTab } from "../../replicas/mobile/SessionsTab";
import { Touch } from "../../replicas/mobile/Touch";
import { ToolRun } from "../../replicas/mobile/ToolRun";
import { AgentMessage } from "../../replicas/mobile/TranscriptRows";
import { UserMessageRow } from "../../replicas/mobile/UserMessageRow";
import { BUILD_KICKOFF_TIME, BUILDER_PLAN } from "../../sample/mobile";
import { BUILDER_SESSION, KICKOFF } from "../../sample/studio";
import { TASKS } from "../../sample/tasks";
import { LAST_SESSIONS, PASSED, RAIL, READY, REQUEST, RUNS, STEPS, TOOLS } from "./sample";
import "./view.css";

export function MobileNeedsYouView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="mobile-needs-you"
      alt={`The OpenDucktor mobile app on a phone. The Sessions tab lists the sessions of every open workspace in the groups Needs you, Running, and Recent. The Sessions tab icon shows a red badge with 1. In Needs you, the Builder session of the task "${TASKS.k3x9.title}" shows the badge In progress and the chip Permission. The user taps the session. The session opens with the workflow rail, where the Builder step waits for input. Its finished tool runs are folded to one line each, such as Shell, 8 commands. Under the transcript is an amber card: Approval required, Bash approval requested, Effect unknown, Codex wants to run a shell command, Command: ${REQUEST.command}, Action: Bash, and the buttons Approve once, Approve for session, and Reject. The composer shows Waiting and a Stop button. The user taps Approve once. The card goes, and the Builder runs ${REQUEST.command} in a new tool run, with moving bars in place of the icon of the command. It reports that 5 tests pass, the tool run folds, and the Builder starts the type check. The user goes back. The session is now in Running, Needs you shows 0, and the badge is gone. Next to the phone, a list of five steps highlights the current step.`}
    >
      <MobileStage
        steps={STEPS}
        phone={
          <PhoneFrame overlay={<Touch />}>
            <SessionsTab entries={LAST_SESSIONS} />
            <SessionScreen
              id="session"
              title={TASKS.k3x9.title}
              session={BUILDER_SESSION}
              steps={RAIL.working}
              role="build"
              activity="working"
              hidden
              rows={
                <>
                  <UserMessageRow text={KICKOFF.build} time={BUILD_KICKOFF_TIME} />
                  <ToolRun tools={TOOLS} calls={RUNS.lookups} row="lookups" folded />
                  <AgentMessage paragraphs={[BUILDER_PLAN]} />
                  <ToolRun tools={TOOLS} calls={RUNS.checks} row="checks" folded />
                  <AgentMessage paragraphs={[READY]} row="ready" />
                  <ToolRun tools={TOOLS} calls={RUNS.tests} row="tests" folded />
                  <AgentMessage paragraphs={[PASSED]} row="passed" />
                  <ToolRun tools={TOOLS} calls={RUNS.types} row="types" running="typecheck" />
                </>
              }
              pending={<PermissionCard request={REQUEST} hidden />}
            />
          </PhoneFrame>
        }
      />
    </SceneFrame>
  );
}
