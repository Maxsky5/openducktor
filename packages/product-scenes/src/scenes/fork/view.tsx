// A fork of a workspace session: the session page with two turns, the Fork session dialog over the
// window, and the page of the new session that opens after the fork. The markup holds the dialog
// with New worktree selected, the frame that shows the most. Sources:
// packages/frontend/src/components/features/agents/agent-chat/agent-chat-fork-actions.tsx,
// packages/frontend/src/pages/workspace-sessions, and packages/frontend/src/features/session-startup.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Composer, ComposerDraft } from "../../replicas/studio/Composer";
import { SessionPane } from "../../replicas/studio/SessionPage";
import { SessionWindow } from "../../replicas/studio/SessionWindow";
import { WorkspaceSessionHeader } from "../../replicas/studio/WorkspaceSessionHeader";
import { ForkDialog } from "../../replicas/studio/ForkDialog";
import { StartupProgress } from "../../replicas/studio/StartupProgress";
import { AgentText } from "../../replicas/transcript/AgentText";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { signature } from "../../sample/sessions";
import {
  FOLLOW_UP,
  FORK_TITLE,
  NAV,
  ORIGIN,
  SESSION,
  SOURCE,
  STEPS,
  TITLE,
  TURNS,
  WORKTREE,
} from "./sample";

/** A turn of the session: the message and the final reply with its copy and fork buttons. */
function Turn({
  turn,
  row,
}: {
  turn: (typeof TURNS)[keyof typeof TURNS];
  row: string;
}): ReactElement {
  return (
    <>
      <UserMessage time={turn.time} row={`${row}-message`}>
        {turn.message}
      </UserMessage>
      <AgentText signature={signature(SESSION)} worked={turn.worked} row={`${row}-reply`} actions>
        <p>{turn.reply}</p>
      </AgentText>
    </>
  );
}

export function ForkView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="fork"
      alt="A workspace session, Profile the slow search, in the worktree search-profile, with two turns. The visitor selects Fork from this reply on the first reply of the agent. The Fork session dialog opens. The visitor selects New worktree, and the form suggests the worktree name search-profile-fork and the branch odt/search-profile-fork. Then the visitor selects Fork session. The dialog shows the startup steps: Create workspace worktree, Set branch upstream, and Start session. The new session, Profile the slow search (fork), opens with the first turn only and shows in the sidebar next to the source session. The visitor sends another follow-up, and the agent starts to work."
    >
      <SessionWindow
        nav={NAV}
        keys={props.keys}
        session={SESSION}
        pane="main"
        dialog={
          <ForkDialog
            location="new_worktree"
            source={SOURCE}
            worktree={WORKTREE}
            progress={<StartupProgress origin={ORIGIN} steps={STEPS} />}
          />
        }
      >
        <SessionPane
          data-page="source"
          header={<WorkspaceSessionHeader title={TITLE} />}
          chat={
            <>
              <Turn turn={TURNS.first} row="first" />
              <Turn turn={TURNS.second} row="second" />
            </>
          }
          composer={<Composer session={SESSION} />}
        />
        <SessionPane
          hidden
          data-page="fork"
          header={<WorkspaceSessionHeader title={FORK_TITLE} />}
          chat={
            <>
              <Turn turn={TURNS.first} row="first" />
              <UserMessage time="10:36:02 AM" row="follow-up">
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
