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
import { AgentMessage, ToolRow, UserBubble } from "../../replicas/mobile/TranscriptRows";
import { BUILDER_PLAN } from "../../sample/mobile";
import { BUILDER_SESSION, KICKOFF } from "../../sample/studio";
import { TASKS } from "../../sample/tasks";
import { LAST_SESSIONS, PASSED, RAIL, READY, REQUEST, STEPS, TOOLS } from "./sample";
import "./view.css";

export function MobileNeedsYouView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="mobile-needs-you"
      alt={`The OpenDucktor mobile app on a phone. The Sessions tab lists the sessions of every open workspace in the groups Needs you, Running, and Recent. The Sessions tab icon shows a red badge with 1. In Needs you, the Builder session of the task "${TASKS.k3x9.title}" shows the badge In progress and the chip Permission. The user taps the session. The session opens with the workflow rail, where the Builder step waits for input, and with an amber card: Approval required, Bash approval requested, Effect unknown, Codex wants to run a shell command, Command: ${REQUEST.command}, Action: Bash, and the buttons Approve once, Approve for session, and Reject. The composer asks to respond to the pending approval request. The user taps Approve once. The card goes, the Builder runs ${REQUEST.command}, reports that 5 tests pass, and starts the type check. The user goes back. The session is now in Running, Needs you shows 0, and the badge is gone. Next to the phone, a list of five steps highlights the current step.`}
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
                  <UserBubble text={KICKOFF.build} />
                  <ToolRow tools={TOOLS} id="guide" />
                  <ToolRow tools={TOOLS} id="status" />
                  <ToolRow tools={TOOLS} id="keymap" />
                  <ToolRow tools={TOOLS} id="search" />
                  <ToolRow tools={TOOLS} id="app" />
                  <ToolRow tools={TOOLS} id="shell" />
                  <ToolRow tools={TOOLS} id="dialog" />
                  <ToolRow tools={TOOLS} id="dialogTest" />
                  <AgentMessage paragraphs={[BUILDER_PLAN]} />
                  <ToolRow tools={TOOLS} id="read" />
                  <ToolRow tools={TOOLS} id="list" />
                  <ToolRow tools={TOOLS} id="lint" />
                  <AgentMessage paragraphs={[READY]} row="ready" />
                  <ToolRow tools={TOOLS} id="test" />
                  <AgentMessage paragraphs={[PASSED]} row="passed" />
                  <ToolRow tools={TOOLS} id="typecheck" />
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
