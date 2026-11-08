// The mobile app approves a task in Human Review. The Builder session of the search shortcut task
// is open, and every step of the workflow rail is done. The zap button opens Quick Actions, and
// Approve Task opens the approval sheet on Pull request, because the Git provider creates pull
// requests. The visitor chooses Direct merge and Squash, reads the suggested commit message, and
// merges locally. The target branch has a remote, so the sheet asks to push it: Push main and mark
// done publishes the merge, the task moves to Done, and a toast says so. Sources:
// session-header.tsx and session-header-menus.ts in apps/mobile/src/features/session/header,
// approve-task-sheet.tsx and approval-views.tsx in apps/mobile/src/features/workflow/approve, and
// use-task-approval-flow.ts in packages/frontend-core. The markup holds the last frame. A phone
// stage shows only the phone.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { ApproveTaskSheet, PublishSheet } from "../../replicas/mobile/ApproveSheet";
import { MobileStage } from "../../replicas/mobile/MobileStage";
import { MobileToast } from "../../replicas/mobile/MobileToast";
import { PhoneFrame } from "../../replicas/mobile/PhoneFrame";
import { QuickActionsMenu } from "../../replicas/mobile/QuickActionsMenu";
import { SessionScreen } from "../../replicas/mobile/SessionScreen";
import { Touch } from "../../replicas/mobile/Touch";
import { AgentMessage, ToolRow, UserBubble } from "../../replicas/mobile/TranscriptRows";
import { BUILDER_FIX_SESSION, KICKOFF } from "../../sample/studio";
import {
  BRANCH,
  DESTINATIONS,
  DONE,
  MERGED_COMMIT,
  QUICK_ACTIONS,
  RAIL,
  REMOTE_BRANCH,
  SQUASH_HINT,
  SQUASH_MESSAGE,
  STEPS,
  SUMMARY,
  TASK,
  TITLE,
  TOOLS,
} from "./sample";
import "./view.css";

export function MobileApproveView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="mobile-approve"
      alt={`The OpenDucktor mobile app on a phone. The Builder session of the task "${TITLE}" is open, and the workflow rail shows Spec, Planner, Builder, and QA as done. The user taps the zap button. The menu Quick Actions lists Generate Pull Request, Request Changes, Request QA Review, Start Implementation, Start Spec, Start Planner, Approve Task, Open Builder, and, in red after a divider, Reset Implementation. The user taps Approve Task. The sheet Approve task opens with the task title and ID. Its Approval action control shows Direct merge, Pull request, and Close task, with Pull request chosen: the pull request draft offers Write manually and Ask Builder, and the button reads Choose Builder session. The user taps Direct merge. The merge methods Merge commit, Squash, and Rebase show, then the switch Remove worktree and branch, which is on, with No uncommitted changes. The user taps Squash. The field Squash commit message shows "${SQUASH_MESSAGE}", with the note to edit the message before the one commit on ${BRANCH}. The user taps Merge locally. The sheet changes to Publish and mark done: Local merge ready, the code is already merged into ${BRANCH} on this computer, and the next step pushes ${REMOTE_BRANCH}. Under the note about Finish later, Finish later fills a row, and Cancel and Push ${BRANCH} and mark done share the row under it. The user taps Push ${BRANCH} and mark done. The sheet closes, and a toast says ${DONE.message}, ${DONE.description}. The toast goes, and the workflow rail shows every step done. Next to the phone, a list of five steps highlights the current step.`}
    >
      <MobileStage
        steps={STEPS}
        phone={
          <PhoneFrame
            overlay={
              <>
                <QuickActionsMenu items={QUICK_ACTIONS} hidden />
                <MobileToast
                  kind="success"
                  message={DONE.message}
                  description={DONE.description}
                  toast="done"
                />
                <Touch />
              </>
            }
          >
            <SessionScreen
              id="session"
              title={TITLE}
              session={BUILDER_FIX_SESSION}
              steps={RAIL}
              role="build"
              activity="idle"
              rows={
                <>
                  <UserBubble text={KICKOFF.fix} />
                  <ToolRow tools={TOOLS} id="test" />
                  <ToolRow tools={TOOLS} id="lint" />
                  <ToolRow tools={TOOLS} id="commit" />
                  <AgentMessage paragraphs={[SUMMARY]} row="summary" />
                </>
              }
            />
            <ApproveTaskSheet
              task={TASK}
              mode="direct_merge"
              method="squash"
              squashMessage={SQUASH_MESSAGE}
              squashHint={SQUASH_HINT}
              pullRequestRole="Builder"
              hidden
            />
            <PublishSheet
              task={TASK}
              branch={BRANCH}
              remoteBranch={REMOTE_BRANCH}
              commit={MERGED_COMMIT}
              destinations={DESTINATIONS}
              hidden
            />
          </PhoneFrame>
        }
      />
    </SceneFrame>
  );
}
