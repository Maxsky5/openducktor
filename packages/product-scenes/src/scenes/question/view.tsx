// A Spec session that waits for your answers. The sidebar shows it in Needs you, and you open it
// and answer its questions in the question card above the composer. Sources:
// session-navigation-list.tsx in packages/frontend/src/components/layout/sidebar, and
// agent-session-question-card.tsx in packages/frontend/src/components/features/agents/agent-chat.
// The markup holds the frame from the middle of the loop that shows the most: the open session in
// Needs you, with its first question.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { AppWindow } from "../../replicas/shell/AppWindow";
import { Pointer } from "../../replicas/shell/Pointer";
import { AgentText } from "../../replicas/transcript/AgentText";
import { Answers } from "../../replicas/transcript/Answers";
import { QuestionCard } from "../../replicas/transcript/QuestionCard";
import { ToolRow } from "../../replicas/transcript/ToolRow";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { SPEC_QUESTIONS } from "../../sample/question";
import { SPEC_SESSION } from "../../sample/studio";
import { ANSWERS, KICKOFF_ROW, OPENED_NAV, QUESTION_ROW, READ_ROWS, SYNC_SESSION } from "./sample";
import { SessionPage } from "./SessionPage";
import "./view.css";

/** The Builder of the offline sync task, which shows when the scene starts. */
function SyncPage(): ReactElement {
  return (
    <SessionPage
      page="sync"
      task="b8t1"
      tones={["done", "done", "in_progress", "blocked"]}
      role="build"
      action="Start Implementation"
      session={SYNC_SESSION}
      activity="working"
      hidden
    >
      <AgentText>
        <p>
          The sync client now shows{" "}
          <code>You are offline. Sync starts again when you reconnect.</code> Next, I will run the
          sync tests.
        </p>
      </AgentText>
      <ToolRow
        kind="read"
        name="Read"
        args="src/sync/sync-client.ts"
        duration="11ms"
        time="09:40:52 AM"
      />
      <ToolRow
        kind="bash"
        name="Bash"
        args="bun test src/sync"
        duration="3.2s"
        time="09:40:55 AM"
        running
      />
    </SessionPage>
  );
}

/** The Spec session of the search shortcut task, which waits for the answers. */
function SpecPage(): ReactElement {
  return (
    <SessionPage
      page="spec"
      task="k3x9"
      tones={["waiting_input", "blocked", "blocked", "blocked"]}
      role="spec"
      action="Start Spec"
      session={SPEC_SESSION}
      activity="waiting"
      stack={<QuestionCard questions={SPEC_QUESTIONS} />}
    >
      <UserMessage time={KICKOFF_ROW.time}>{KICKOFF_ROW.text}</UserMessage>
      {READ_ROWS.map((row) => (
        <ToolRow
          key={row.id}
          kind={row.tool}
          name={row.name}
          args={row.args}
          duration={row.duration}
          time={row.time}
        />
      ))}
      <ToolRow
        kind={QUESTION_ROW.tool}
        name={QUESTION_ROW.name}
        args={QUESTION_ROW.args}
        duration={QUESTION_ROW.duration}
        time={QUESTION_ROW.time}
        row="question"
        running
      >
        <div hidden data-row="answers">
          <Answers items={ANSWERS} />
        </div>
      </ToolRow>
      <div hidden data-row="next">
        <ToolRow
          kind="read"
          name="Read"
          args="src/app/app-shell.tsx"
          duration="9ms"
          time="09:42:01 AM"
        />
      </div>
    </SessionPage>
  );
}

export function QuestionView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="question"
      alt="The session sidebar shows a Spec session in the Needs you group, with a Question badge. The developer selects the session, and its page opens with a question card above the composer. The card has two questions. The developer selects Cmd+K / Ctrl+K for the first question, and the card moves to the second question. The developer selects No, ignore it in text fields, and the Summary tab shows both answers. The developer selects Confirm Answers. The card closes, the answers show in the transcript, the agent continues, and the session moves to the Running group."
    >
      <AppWindow
        chrome={{
          sidebar: "full",
          nav: { scope: "current", entries: OPENED_NAV },
          version: null,
          pinned: true,
        }}
        keys={props.keys}
        className="aq-window"
        pane="main"
        overlay={<Pointer />}
      >
        <SyncPage />
        <SpecPage />
      </AppWindow>
    </SceneFrame>
  );
}
