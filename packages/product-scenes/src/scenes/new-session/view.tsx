// A new workspace session from the sidebar: the Kanban board with the open sidebar, the draft page
// of a new session, and the session that starts from its first message. The markup holds the
// draft with New worktree and the typed message, just before the visitor sends it: the frame that
// shows the most. The session page under it holds the startup card, the message, and the first
// calls of the agent, which the timeline shows later. The templates hold the menu of the arrow
// beside New task and the popovers of the options bar. Sources:
// packages/frontend/src/components/layout/sidebar/session-create-split-action.tsx,
// packages/frontend/src/pages/workspace-sessions, and packages/frontend/src/features/session-startup.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { Board } from "../../replicas/board/Board";
import { BoardHead } from "../../replicas/board/BoardHead";
import type { KeyLabels } from "../../replicas/keys";
import { CreateMenu } from "../../replicas/shell/CreateMenu";
import { Composer, ComposerDraft } from "../../replicas/studio/Composer";
import { BranchPopover, LocationMenu } from "../../replicas/studio/DraftPopovers";
import { GitPanel } from "../../replicas/studio/GitPanel";
import { PanelTabs } from "../../replicas/studio/PanelTabs";
import { AddAction } from "../../replicas/studio/RepoActions";
import { DRAFT_TEXT, DraftHeader, DraftStage } from "../../replicas/studio/SessionDraft";
import { SessionPane } from "../../replicas/studio/SessionPage";
import { SessionWindow } from "../../replicas/studio/SessionWindow";
import { StartupCard } from "../../replicas/studio/StartupCard";
import { WorkspaceSessionHeader } from "../../replicas/studio/WorkspaceSessionHeader";
import { ToolRun } from "../../replicas/transcript/ToolRun";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { WORKSPACE } from "../../sample/workspace";
import {
  BOARD,
  BRANCH_PLACEHOLDER,
  CALLS,
  EMPTY_DIFF,
  ISSUE_IMPORT,
  LANES,
  MESSAGE,
  NAMED,
  NAV,
  type NewSessionTemplate,
  SENT_TIME,
  SESSION,
  STEPS,
  TARGET,
} from "./sample";
import "./view.css";

function NewSessionStock({ keys }: { keys: KeyLabels }): ReactElement {
  return (
    <>
      <Stock name={"menu" satisfies NewSessionTemplate}>
        <CreateMenu importLabel={ISSUE_IMPORT} keys={keys} />
      </Stock>
      <Stock name={"location" satisfies NewSessionTemplate}>
        <LocationMenu selected="local_repo_root" />
      </Stock>
      <Stock name={"branch" satisfies NewSessionTemplate}>
        <BranchPopover placeholder={BRANCH_PLACEHOLDER} />
      </Stock>
    </>
  );
}

/**
 * The right panel that the ready session opens: the Diffs tab of the new worktree, with no changes
 * against the target branch yet.
 */
function RightPanel(): ReactElement {
  return (
    <div className="ns-right" data-right-content="">
      <PanelTabs active="diffs" artifacts={false} />
      <GitPanel
        files={[]}
        ahead={0}
        branches={{ current: NAMED.branch, target: TARGET }}
        detect={false}
        empty={{ title: EMPTY_DIFF }}
      />
    </div>
  );
}

export function NewSessionView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="new-session"
      alt={`The Kanban board with the open sidebar. The visitor opens the arrow beside New task and selects New session. The draft page opens with the heading Start a new session in fieldnotes, and the sidebar shows the draft New session with the Draft badge at the top of Recent. Under the composer, the visitor opens the work location menu and selects New worktree. Auto branch shows next to it, with the target branch ${TARGET} and No role on the right. The visitor opens Auto branch: on the New branch tab, the Branch name is empty, and the hint says Leave empty to name from your first message. The visitor types the first message: ${MESSAGE} The draft in the sidebar takes the message as its title. The visitor sends the message. The composer moves to the bottom, and the transcript shows the startup card Starting session with four steps and the message with Sending… under it. The draft moves to Running with the Starting badge. The step Generate branch name and session title completes, and the visitor opens it: the naming model named the branch ${NAMED.branch}. Then Create workspace worktree completes, and the session takes the title ${NAMED.title} in the top bar and in the sidebar. Start session and Submit initial instruction complete, and the card folds to Session ready, 4/4. The actions of the top bar show. The message shows its time. The Diffs panel opens on the right with ${NAMED.branch} against ${TARGET} and ${EMPTY_DIFF}. The sidebar row loses its Starting badge. The agent runs two shell commands, and the context meter shows its use.`}
      stock={<NewSessionStock keys={props.keys} />}
    >
      <SessionWindow
        nav={NAV}
        keys={props.keys}
        session={SESSION}
        pane="main"
        className="ns-window"
        dialog={null}
      >
        <div className="page-pane" hidden data-page="board">
          <BoardHead />
          <Board board={BOARD} lanes={LANES} />
        </div>
        <SessionPane
          className="sd-page"
          data-page="session"
          data-draft=""
          header={
            <>
              <div data-header="draft">
                <DraftHeader workspace={WORKSPACE} message={MESSAGE} />
              </div>
              <div hidden data-header="session">
                <WorkspaceSessionHeader title={NAMED.title}>
                  <AddAction />
                </WorkspaceSessionHeader>
              </div>
            </>
          }
          chat={
            <>
              <StartupCard steps={STEPS} hidden />
              <UserMessage time={SENT_TIME} row="message">
                {MESSAGE}
              </UserMessage>
              <ToolRun calls={CALLS} hidden />
            </>
          }
          panel={<RightPanel />}
          composer={
            <DraftStage workspace={WORKSPACE} location="local_worktree" target={TARGET}>
              <Composer session={SESSION} keys={props.keys} filled meter={false}>
                <span className="when-starting">{DRAFT_TEXT.starting}</span>
                <ComposerDraft text={MESSAGE} />
              </Composer>
            </DraftStage>
          }
        />
      </SessionWindow>
    </SceneFrame>
  );
}
