// The mobile app approves a task in Human Review with a pull request that the Builder writes. The
// Builder session of the search shortcut task is open, and every step of the workflow rail is
// done. The zap button opens Quick Actions, and Approve Task opens the approval sheet, which loads
// the task details, then shows Pull request with Ask Builder chosen. Choose Builder session changes
// the sheet to the start of the pull request launch: Reuse existing continues the latest Builder
// session. Start session sends the pull request prompt to that session, and the app opens it over
// the session under the sheet. The Builder says what it does, runs the tests, pushes the branch,
// and creates pull request 42. Its next message folds the run, and its Set Pull Request call saves
// the pull request on the task: the card of the call shows PR #42. The Builder reports the pull
// request. Sources: session-header.tsx in apps/mobile/src/features/session/header,
// approve-task-sheet.tsx and approval-views.tsx in apps/mobile/src/features/workflow/approve,
// session-start-form.tsx in apps/mobile/src/features/workflow/start-session, workflow-tool-row.tsx
// in apps/mobile/src/features/session/transcript/rows, and use-task-approval-flow.ts and
// use-task-session-start-flow.ts in packages/frontend-core. The markup holds the last frame. A
// phone stage shows only the phone.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { ApproveTaskSheet } from "../../replicas/mobile/ApproveSheet";
import { MobileStage } from "../../replicas/mobile/MobileStage";
import { PhoneFrame } from "../../replicas/mobile/PhoneFrame";
import { QuickActionsMenu } from "../../replicas/mobile/QuickActionsMenu";
import { HUMAN_REVIEW_ACTIONS } from "../../replicas/mobile/review-actions";
import { SessionScreen } from "../../replicas/mobile/SessionScreen";
import { StartSessionSheet } from "../../replicas/mobile/StartSessionSheet";
import { Touch } from "../../replicas/mobile/Touch";
import { ToolRun } from "../../replicas/mobile/ToolRun";
import { AgentMessage, TurnSeparator } from "../../replicas/mobile/TranscriptRows";
import { UserMessageRow } from "../../replicas/mobile/UserMessageRow";
import { WorkflowToolCard } from "../../replicas/mobile/WorkflowToolCard";
import {
  FIX_KICKOFF_TIME,
  FIX_RUN,
  FIX_SUMMARY,
  FIX_TOOLS,
  FIX_WORKED,
  OLDEST_COMMIT_MESSAGE,
  REVIEW_RAIL,
  SQUASH_HINT,
} from "../../sample/mobile-review";
import { BUILDER_FIX_SESSION, KICKOFF } from "../../sample/studio";
import {
  EFFORTS,
  NOTES,
  PULL_REQUEST,
  REPORT,
  REQUEST_TIME,
  RUNS,
  SET_PULL_REQUEST,
  START_MODES,
  STEPS,
  TARGET,
  TASK,
  TITLE,
  TOOLS,
  WORKED,
} from "./sample";
import "./view.css";

/** The fix turn of the Builder, which ended before the review. */
function FixTurn(): ReactElement {
  return (
    <>
      <UserMessageRow text={KICKOFF.fix} time={FIX_KICKOFF_TIME} />
      <ToolRun tools={FIX_TOOLS} calls={FIX_RUN} row="fix" folded />
      <TurnSeparator worked={FIX_WORKED} />
      <AgentMessage paragraphs={[FIX_SUMMARY]} footer={BUILDER_FIX_SESSION} row="summary" />
    </>
  );
}

export function MobilePullRequestView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="mobile-pull-request"
      alt={`The OpenDucktor mobile app on a phone. The Builder session of the task "${TITLE}" is open, and the workflow rail shows Spec, Planner, Builder, and QA as done. The user taps the zap button. The menu Quick Actions lists Generate Pull Request, Request Changes, Request QA Review, Start Implementation, Start Spec, Start Planner, Approve Task, Open Builder, and, in red after a divider, Reset Implementation. The user taps Approve Task. The sheet Approve task opens with the task title and ID, and it shows Loading task details for a moment. Then its Approval action control shows Direct merge, Pull request, and Close task, with Pull request chosen. The pull request draft offers Write manually and Ask Builder, and Ask Builder is chosen. The user taps Ask Builder, which stays chosen, and reads the note: Next, choose the Builder session to use. The user taps Choose Builder session. The sheet changes to Start Builder session: Choose how to start this session, the Session mode control with Reuse existing chosen and Fork existing, the existing session ${START_MODES.source}, Target branch ${TARGET}, and Runtime and model GPT-6-Astra on Codex, which a reuse keeps. The user taps Start session. The button shows its progress, and Run in background becomes Continue in background. The sheet closes, and the Builder session opens again with the pull request prompt as the last message. The workflow rail shows the Builder at work. The Builder says that it runs the tests, then pushes the branch and opens the pull request against main. It runs bun test, pushes the branch, and creates the pull request with gh, in one tool run. It says that it adds pull request ${PULL_REQUEST.number} to the task, and the run folds. The card Set Pull Request shows: it runs, then it shows PR #${PULL_REQUEST.number} with a link mark. The turn ends after Worked for ${WORKED}: the Builder reports that pull request ${PULL_REQUEST.number} is open at ${PULL_REQUEST.url}, that bun test passes, and that main requires no pull request check. The workflow rail shows every step done again. Next to the phone, a list of five steps highlights the current step.`}
    >
      <MobileStage
        steps={STEPS}
        phone={
          <PhoneFrame
            overlay={
              <>
                <QuickActionsMenu items={HUMAN_REVIEW_ACTIONS} hidden />
                <Touch />
              </>
            }
          >
            <SessionScreen
              id="session"
              hidden
              title={TITLE}
              session={BUILDER_FIX_SESSION}
              steps={REVIEW_RAIL}
              role="build"
              activity="idle"
              rows={
                <>
                  <FixTurn />
                  <UserMessageRow
                    text={KICKOFF.pullRequest}
                    time={REQUEST_TIME}
                    row="request"
                    hidden
                  />
                </>
              }
            />
            <SessionScreen
              id="pull-request"
              title={TITLE}
              session={BUILDER_FIX_SESSION}
              steps={REVIEW_RAIL}
              role="build"
              activity="idle"
              awayFromTop
              rows={
                <>
                  <FixTurn />
                  <UserMessageRow text={KICKOFF.pullRequest} time={REQUEST_TIME} row="request" />
                  <AgentMessage paragraphs={[NOTES.plan]} row="plan" />
                  <ToolRun tools={TOOLS} calls={RUNS.publish} row="publish" folded />
                  <AgentMessage paragraphs={[NOTES.save]} row="save" />
                  <WorkflowToolCard
                    title={SET_PULL_REQUEST.title}
                    pullRequest={PULL_REQUEST.number}
                    duration={SET_PULL_REQUEST.duration}
                    time={SET_PULL_REQUEST.time}
                    phase="completed"
                    row="set-pull-request"
                  />
                  <TurnSeparator worked={WORKED} row="worked" />
                  <AgentMessage paragraphs={REPORT} footer={BUILDER_FIX_SESSION} row="report" />
                </>
              }
            />
            <ApproveTaskSheet
              task={TASK}
              mode="pull_request"
              method="merge_commit"
              squashMessage={OLDEST_COMMIT_MESSAGE}
              squashHint={SQUASH_HINT}
              pullRequestRole="Builder"
              hidden
            />
            <StartSessionSheet
              role="Builder"
              session={BUILDER_FIX_SESSION}
              target={TARGET}
              efforts={EFFORTS}
              startModes={START_MODES}
              hidden
            />
          </PhoneFrame>
        }
      />
    </SceneFrame>
  );
}
