// The session page of a task in Human Review, cropped to the top bar, the Builder chat, and the
// Diffs tab. The target branch has 2 commits that the task branch does not have. The visitor
// selects Rebase onto target, and the rebase stops on a conflict. The conflict dialog opens, and
// the visitor selects Resolve conflicts, then starts the Builder session again. The Builder
// resolves the file, runs the tests, and finishes the rebase. Sources: agent-studio-git-panel in
// packages/frontend/src/components/features/agents, features/git-conflict-resolution in
// packages/frontend/src, and use-git-conflict-resolution.ts in packages/frontend-core. The markup
// holds the last frame. The strip and the dialogs are templates.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { ConflictDialog, ConflictStrip } from "../../replicas/studio/GitConflict";
import { TARGET_BRANCH } from "../../replicas/studio/GitHeader";
import { GitPanel } from "../../replicas/studio/GitPanel";
import { PanelTabs } from "../../replicas/studio/PanelTabs";
import { Composer } from "../../replicas/studio/Composer";
import { SessionPage } from "../../replicas/studio/SessionPage";
import { Paragraph } from "../../replicas/ui/InlineCode";
import { StartDialog } from "../../replicas/studio/StartDialog";
import { AgentText } from "../../replicas/transcript/AgentText";
import { ToolRow } from "../../replicas/transcript/ToolRow";
import { Transcript } from "../../replicas/transcript/Transcript";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { signature } from "../../sample/sessions";
import { BUILD_FILES, BUILDER_FIX_SESSION } from "../../sample/studio";
import { storySessions } from "../../sample/transcripts";
import {
  CONFLICT_FILES,
  CONFLICT_MESSAGE,
  COUNTS,
  FINAL,
  GIT_OUTPUT,
  type GitConflictTemplate,
  MESSAGE_TIME,
  ROWS,
} from "./sample";
import "./view.css";

/** A row of the Builder turn, from ROWS. */
function Row({ id }: { id: keyof typeof ROWS }): ReactElement {
  const { args, duration, time } = ROWS[id];
  return id === "conflict-read" ? (
    <ToolRow kind="read" name="Read" args={args} duration={duration} time={time} row={id} />
  ) : (
    <ToolRow kind="bash" name="Bash" args={args} duration={duration} time={time} row={id} />
  );
}

function RightPanel(): ReactElement {
  const { ahead, behind, push } = COUNTS.after;
  return (
    <>
      <PanelTabs active="diffs" />
      <GitPanel files={BUILD_FILES} ahead={ahead} behind={behind} push={push} />
    </>
  );
}

function Templates(): ReactElement {
  return (
    <>
      <Stock name={"strip" satisfies GitConflictTemplate}>
        <ConflictStrip target={TARGET_BRANCH} files={CONFLICT_FILES} />
      </Stock>
      <Stock name={"conflict-dialog" satisfies GitConflictTemplate}>
        <ConflictDialog target={TARGET_BRANCH} files={CONFLICT_FILES} output={GIT_OUTPUT} />
      </Stock>
      <Stock name={"start-dialog" satisfies GitConflictTemplate}>
        <StartDialog
          role="Builder"
          session={BUILDER_FIX_SESSION}
          modes={["fresh", "reuse"]}
          mode="reuse"
          existing="Builder #1"
        />
      </Stock>
    </>
  );
}

export function GitConflictView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="git-conflict"
      stock={<Templates />}
      alt={`The session page of a task in Human Review, with the Diffs tab open. The task branch is ${COUNTS.before.ahead} commits ahead of ${TARGET_BRANCH} and ${COUNTS.before.behind} commits behind it. The developer selects Rebase onto target. The rebase stops on a conflict in ${CONFLICT_FILES[0]}, and the Rebase conflict detected dialog opens with the conflicted file and the Git output. A strip at the top of the Diffs tab shows Rebase in progress. The developer selects Resolve conflicts, keeps Reuse existing with the Builder session, and selects Start session. The Builder gets the conflict, reads the file, keeps the changes of both sides, runs the tests, and continues the rebase. The strip goes away, and the task branch is ${COUNTS.after.ahead} commits ahead and 0 behind.`}
    >
      <SessionPage
        session={BUILDER_FIX_SESSION}
        className="gc-window"
        chat={
          <>
            <Transcript sessions={storySessions([{ id: "build", turns: 1 }])} shown="build" />
            <UserMessage time={MESSAGE_TIME} row="conflict-message">
              {CONFLICT_MESSAGE}
            </UserMessage>
            <Row id="conflict-status" />
            <Row id="conflict-read" />
            <Row id="conflict-test" />
            <Row id="conflict-rebase" />
            <AgentText signature={signature(BUILDER_FIX_SESSION)} worked="44s" row="conflict-final">
              <Paragraph text={FINAL} />
            </AgentText>
          </>
        }
        composer={<Composer session={BUILDER_FIX_SESSION} />}
        panel={<RightPanel />}
      />
    </SceneFrame>
  );
}
