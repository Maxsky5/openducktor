// A new workspace session from the sidebar: the Kanban board with the open sidebar, the New session
// dialog over the window, and the session page that opens after the start. The markup holds the
// dialog with New worktree selected and its fields filled, the frame that shows the most. The
// template holds the menu of the arrow beside New task. Sources:
// packages/frontend/src/components/layout/sidebar/session-create-split-action.tsx,
// packages/frontend/src/pages/workspace-sessions, and packages/frontend/src/features/session-startup.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { Board } from "../../replicas/board/Board";
import { BoardHead } from "../../replicas/board/BoardHead";
import { CreateMenu } from "../../replicas/shell/CreateMenu";
import { Composer, ComposerDraft } from "../../replicas/studio/Composer";
import { SessionPane } from "../../replicas/studio/SessionPage";
import { SessionWindow } from "../../replicas/studio/SessionWindow";
import { WorkspaceSessionHeader } from "../../replicas/studio/WorkspaceSessionHeader";
import { SessionCreateDialog } from "../../replicas/studio/SessionCreateDialog";
import { StartupProgress } from "../../replicas/studio/StartupProgress";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import {
  BOARD,
  ISSUE_IMPORT,
  LANES,
  MESSAGE,
  NAME,
  NAV,
  type NewSessionTemplate,
  ORIGIN,
  SESSION,
  STEPS,
  TARGET,
  WORKTREE,
} from "./sample";

export function NewSessionView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="new-session"
      alt="The Kanban board with the open sidebar. The visitor opens the arrow beside New task and selects New session. The New session dialog opens. The visitor types the name Profile the slow search, keeps the runtime and the model, selects New worktree, checks the target branch origin/main, and types the worktree name search-profile. Then the visitor selects Create session. The dialog shows the startup steps: Create workspace worktree, Set branch upstream, and Start session. The session page opens, the visitor sends the first message, and the agent starts to work."
      stock={
        <Stock name={"menu" satisfies NewSessionTemplate}>
          <CreateMenu importLabel={ISSUE_IMPORT} />
        </Stock>
      }
    >
      <SessionWindow
        nav={NAV}
        kanban
        keys={props.keys}
        session={SESSION}
        pane="sidebar"
        dialog={
          <SessionCreateDialog
            session={SESSION}
            target={TARGET}
            location="local_worktree"
            name={NAME}
            worktree={WORKTREE}
            progress={<StartupProgress origin={ORIGIN} steps={STEPS} />}
          />
        }
      >
        <div className="page-pane" data-page="board">
          <BoardHead />
          <Board board={BOARD} lanes={LANES} />
        </div>
        <SessionPane
          hidden
          data-page="session"
          header={<WorkspaceSessionHeader title={NAME} />}
          chat={
            <UserMessage time="10:31:08 AM" row="message">
              {MESSAGE}
            </UserMessage>
          }
          composer={
            <Composer session={SESSION}>
              <ComposerDraft />
            </Composer>
          }
        />
      </SessionWindow>
    </SceneFrame>
  );
}
