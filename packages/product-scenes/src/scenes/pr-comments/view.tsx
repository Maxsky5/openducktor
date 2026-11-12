// The session page of a task with a pull request, cropped to the top bar, the chat of the Builder,
// and the right panel on the CI Checks tab. The Checks section is closed, and the Comments section
// lists the reviews and the comments of the pull request. The visitor filters the comments, hides
// the resolved thread, and reads a suggested change. In the chat, the visitor asks the Builder to
// apply it, and the Builder edits, commits, and pushes. A refresh shows the new review. Sources:
// task-execution-ci-comments-list.tsx, task-execution-ci-comment-card.tsx, and
// task-execution-ci-tab-indicator.tsx in packages/frontend/src/components/features/agents. The
// markup holds the last frame. A phone stage shows only the panel.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { ChecksPanel } from "../../replicas/studio/ChecksPanel";
import { CommentsList } from "../../replicas/studio/CommentsList";
import { PanelTabs } from "../../replicas/studio/PanelTabs";
import { PullRequestLink } from "../../replicas/studio/PullRequestLink";
import { Composer, ComposerDraft } from "../../replicas/studio/Composer";
import { SessionPage } from "../../replicas/studio/SessionPage";
import { Paragraph } from "../../replicas/ui/InlineCode";
import { AgentText } from "../../replicas/transcript/AgentText";
import { PatchCard } from "../../replicas/transcript/PatchCard";
import { ToolRow } from "../../replicas/transcript/ToolRow";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { WorkflowCard } from "../../replicas/transcript/WorkflowCard";
import { signature } from "../../sample/sessions";
import { BUILDER_PR_SESSION, CI_CHECKS, HOOK_PATH, PR_TITLE } from "../../sample/studio";
import { APPLIED, ASK, COMMENTS, NOW, PR_NUMBER, READY, ROWS, UPDATED } from "./sample";
import "../../replicas/studio/PanelTabs.css";
import "./view.css";

/** A Bash row of the chat, from ROWS. */
function Bash({ id }: { id: keyof typeof ROWS }): ReactElement {
  const { args, duration, time } = ROWS[id];
  return <ToolRow kind="bash" name="Bash" args={args} duration={duration} time={time} row={id} />;
}

/**
 * The right panel on the CI Checks tab. The tab shows the status of the checks and the count of
 * the open review threads on its icon.
 */
function RightPanel(): ReactElement {
  const open = COMMENTS.filter((comment) => comment.resolved === false).length;
  return (
    <>
      <PanelTabs active="ci_checks" checks={{ threads: open }} fadeStart showEnd />
      <div>
        <ChecksPanel
          title={PR_TITLE}
          updated={UPDATED.last}
          checks={CI_CHECKS.map((name) => ({ name, state: "success" }))}
          checksClosed
          comments={<CommentsList comments={COMMENTS} now={NOW.last} hideResolved />}
        />
      </div>
    </>
  );
}

export function PrCommentsView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="pr-comments"
      alt={`The session page of a task with pull request ${PR_NUMBER}. The right panel shows the CI Checks tab. The Checks section is closed and shows 4 passing. The Comments section shows 4 items: a review from maya with the badge Changes requested, an unresolved review thread from maya on src/search/use-search-shortcut.ts line 14, a comment from codecov with the Bot badge, and a resolved thread from maya on src/app/app-shell.tsx line 8. The filter shows All 4, Humans 3, and Bots 1. The developer selects Humans, and the codecov comment leaves the list. The developer selects All again. Then the developer opens Filter comments and turns on Hide resolved, and the resolved thread leaves the list. The developer scrolls to the open thread: it shows the code of the thread, the comment, and a suggested change that adds a check for event.isComposing. In the chat, the developer asks the Builder to apply the suggestion of maya and push. The Builder edits the file, commits, and pushes. The developer selects Refresh CI checks. A new review from maya with the badge Approved shows at the top of the list. The thread stays unresolved.`}
    >
      <SessionPage
        session={BUILDER_PR_SESSION}
        className="pc-window"
        actions={<PullRequestLink number={PR_NUMBER} />}
        chat={
          <>
            <Bash id="create" />
            <WorkflowCard
              title="Set Pull Request"
              icon="pull_request"
              pr={PR_NUMBER}
              duration="52ms"
              time="10:24:44 AM"
            />
            <Bash id="watch" />
            <AgentText signature={signature(BUILDER_PR_SESSION)} worked="5m 31s" row="ready">
              <Paragraph text={READY} />
            </AgentText>
            <UserMessage time="10:43:20 AM" row="ask">
              {ASK}
            </UserMessage>
            <PatchCard path={HOOK_PATH} kind="M" add={1} row="edit" />
            <Bash id="commit" />
            <Bash id="push" />
            <AgentText signature={signature(BUILDER_PR_SESSION)} worked="29s" row="applied">
              <Paragraph text={APPLIED} />
            </AgentText>
          </>
        }
        composer={
          <Composer session={BUILDER_PR_SESSION}>
            <ComposerDraft />
          </Composer>
        }
        panel={<RightPanel />}
      />
    </SceneFrame>
  );
}
