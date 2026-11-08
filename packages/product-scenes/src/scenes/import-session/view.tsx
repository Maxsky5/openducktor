// An import of a Claude Code conversation: the Kanban board with the open sidebar, the Import
// session dialog over the window, and the session page that opens after the import with the
// history of the conversation. The markup holds the dialog with the runtime and the full list, the
// frame that shows the most. The template holds the menu of the arrow beside New task. Sources:
// packages/frontend/src/components/layout/sidebar/session-create-split-action.tsx and
// packages/frontend/src/pages/workspace-sessions.
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
import { ImportSessionDialog } from "../../replicas/studio/ImportSessionDialog";
import { AgentText } from "../../replicas/transcript/AgentText";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { signature } from "../../sample/sessions";
import {
  BOARD,
  FOLLOW_UP,
  IMPORTED,
  type ImportSessionTemplate,
  ISSUE_IMPORT,
  LANES,
  NAV,
  RUNTIME,
  RUNTIMES,
  SESSION,
  SESSIONS,
  TURN,
} from "./sample";
import "./view.css";

export function ImportSessionView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="import-session"
      alt="The Kanban board with the open sidebar. The visitor opens the arrow beside New task and selects Import session from an external runtime. The Import session dialog opens. The visitor chooses the runtime Claude, and the dialog lists four Claude Code conversations of the repository and of its worktree, each with its title, its directory, its session ID, and its time. The visitor types search, and two conversations match. The visitor selects Import on Speed up search in large notebooks. The session page opens with the history of the conversation, and the session shows in the sidebar. The visitor sends a follow-up, and the agent starts to work."
      stock={
        <Stock name={"menu" satisfies ImportSessionTemplate}>
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
        className="im-window"
        dialog={<ImportSessionDialog runtimes={RUNTIMES} runtime={RUNTIME} sessions={SESSIONS} />}
      >
        <div className="page-pane" data-page="board">
          <BoardHead />
          <Board board={BOARD} lanes={LANES} />
        </div>
        <SessionPane
          hidden
          data-page="session"
          header={<WorkspaceSessionHeader title={IMPORTED.title} />}
          chat={
            <>
              <UserMessage time={TURN.time} row="message">
                {TURN.message}
              </UserMessage>
              <AgentText signature={signature(SESSION)} worked={TURN.worked} row="reply" actions>
                <p>{TURN.reply}</p>
              </AgentText>
              <UserMessage time="10:42:15 AM" row="follow-up">
                {FOLLOW_UP}
              </UserMessage>
            </>
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
