// The mobile app sends a comment on diff lines to the Builder of the search shortcut task. The
// visitor opens Changes from the session menu, shows Branch changes, opens the diff of the hook
// under its row, and opens its full diff from the file menu. A tap selects line 9, a tap on line
// 10 extends the range, and Comment opens the comment field. The saved comment shows Pending.
// Back in Changes, Send opens the session, where the composer counts the pending comment. The
// visitor sends a message, and the comment goes with it. The markup holds the frame where the
// composer counts the pending comment, so the static frame shows where the comment waits. Sources: session-header.tsx in
// apps/mobile/src/features/session/header, changes-screen.tsx, file-diff-screen.tsx, and
// diff-comment-flow.tsx in apps/mobile/src/features/review, and pending-comments-notice.tsx in
// apps/mobile/src/features/composer. A phone stage shows only the phone.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { ActionMenu } from "../../replicas/mobile/ActionMenu";
import { ChangesScreen } from "../../replicas/mobile/ChangesScreen";
import { DiffLines } from "../../replicas/mobile/DiffRows";
import { DiffScreen } from "../../replicas/mobile/DiffScreen";
import { MobileStage } from "../../replicas/mobile/MobileStage";
import { PendingCommentsNotice } from "../../replicas/mobile/PendingCommentsNotice";
import { PhoneFrame } from "../../replicas/mobile/PhoneFrame";
import { SessionScreen } from "../../replicas/mobile/SessionScreen";
import { Touch } from "../../replicas/mobile/Touch";
import { AgentMessage, ToolRow, UserBubble } from "../../replicas/mobile/TranscriptRows";
import { UserMessageRow } from "../../replicas/mobile/UserMessageRow";
import { BUILDER_SESSION, KICKOFF } from "../../sample/studio";
import { TASKS } from "../../sample/tasks";
import {
  ANSWER,
  BRANCH,
  COMMENT,
  DONE,
  FILE_ACTIONS,
  HOOK,
  MENU_TITLE,
  RAIL,
  ROWS,
  SENT_MESSAGE,
  SENT_TIME,
  SESSION_ACTIONS,
  STEPS,
  TOOLS,
} from "./sample";
import "./view.css";

/** The rows of the session before the visitor opens Changes. */
function EarlierRows(): ReactElement {
  return (
    <>
      <UserBubble text={KICKOFF.build} />
      <ToolRow tools={TOOLS} id="guide" />
      <ToolRow tools={TOOLS} id="keymapRead" />
      <ToolRow tools={TOOLS} id="list" />
      <ToolRow tools={TOOLS} id="shell" />
      <ToolRow tools={TOOLS} id="lint" />
      <ToolRow tools={TOOLS} id="test" />
      <ToolRow tools={TOOLS} id="typecheck" />
      <ToolRow tools={TOOLS} id="commit" />
      <AgentMessage paragraphs={[DONE]} />
    </>
  );
}

export function MobileDiffCommentView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="mobile-diff-comment"
      alt={`The OpenDucktor mobile app on a phone. The Builder session of the task "${TASKS.k3x9.title}" is open, and its turn has ended. The user taps the more button in the header. The session menu opens under the title ${MENU_TITLE}: Task Details, Copy Task ID, Changes, Files, Artifacts, CI Checks, and Terminals. The user taps Changes. The Changes view shows the branch card and the tabs Uncommitted changes and Branch changes. Uncommitted changes shows No changes detected. The user taps Branch changes, which lists 4 changed files as a tree, and taps use-search-shortcut.ts. Its diff opens under the row. The user taps the more button of the row and then Open full diff. The full diff of use-search-shortcut.ts opens, with all 20 lines added. The user taps line ${COMMENT.afterLine - 1}, and a bar at the bottom shows Line ${COMMENT.afterLine - 1}, new lines and the Comment button. The user taps line ${COMMENT.afterLine}, and the bar shows Lines ${COMMENT.afterLine - 1} to ${COMMENT.afterLine}, new lines. The user taps Comment, types "${COMMENT.text}" in the field Add a comment for the Builder, and saves. A card with the badge Pending shows the comment under line ${COMMENT.afterLine}. The user goes back. Changes now shows a Pending card: 1 comment, it goes with the next message to the Builder, and a Send button. The user taps Send. The session opens, and the composer shows: 1 pending review comment goes with your next message. The send button shows the count 1. The user types a message and sends it. The message shows in the transcript with the comment under it: the file, the lines, the code, and the instruction. The Builder reads src/app/keymap.ts and answers. Next to the phone, a list of six steps highlights the current step.`}
    >
      <MobileStage
        steps={STEPS}
        phone={
          <PhoneFrame overlay={<Touch />}>
            <SessionScreen
              id="session"
              title={TASKS.k3x9.title}
              session={BUILDER_SESSION}
              steps={RAIL.idle}
              role="build"
              activity="idle"
              hidden
              rows={<EarlierRows />}
            />
            <ChangesScreen
              id="changes"
              branch={BRANCH}
              target="main"
              ahead={1}
              rows={ROWS}
              open={HOOK.id}
              diff={<DiffLines lines={HOOK.lines} comment={COMMENT} />}
              recipient="Builder"
              hidden
            />
            <DiffScreen id="diff" path={HOOK.path} lines={HOOK.lines} comment={COMMENT} hidden />
            <SessionScreen
              id="reply"
              title={TASKS.k3x9.title}
              session={BUILDER_SESSION}
              steps={RAIL.idle}
              role="build"
              activity="idle"
              rows={
                <>
                  <EarlierRows />
                  <UserMessageRow text={SENT_MESSAGE} time={SENT_TIME} row="sent" hidden />
                  <ToolRow tools={TOOLS} id="keymap" hidden />
                  <AgentMessage paragraphs={[ANSWER]} row="answer" hidden />
                </>
              }
              composer={{ notice: <PendingCommentsNotice count={1} />, pendingCount: 1 }}
            />
            <ActionMenu menu="session" title={MENU_TITLE} actions={SESSION_ACTIONS} />
            <ActionMenu
              menu="file"
              title={`${HOOK.path.split("/").at(-1)}`}
              actions={FILE_ACTIONS}
            />
          </PhoneFrame>
        }
      />
    </SceneFrame>
  );
}
