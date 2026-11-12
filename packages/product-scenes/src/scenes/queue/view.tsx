// The chat column of a Builder session while the agent works: the transcript, the queued message
// stack, and the composer. Sources: agent-chat-composer.tsx, agent-chat-message-queue.tsx, and
// agent-chat-queued-message-stack.tsx in packages/frontend/src/components/features/agents/agent-chat.
// The markup holds the frame from the middle of the loop that shows the most: the open stack and
// the hint of Steer now. The rows that come after it are hidden.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { steerKey } from "../../replicas/keys";
import { Replica } from "../../replicas/Replica";
import { KeyHud } from "../../replicas/shell/KeyHud";
import { Pointer } from "../../replicas/shell/Pointer";
import { ChatColumn } from "../../replicas/studio/ChatColumn";
import { Composer, ComposerDraft } from "../../replicas/studio/Composer";
import { QueueStack } from "../../replicas/studio/QueueStack";
import { AgentText } from "../../replicas/transcript/AgentText";
import { PatchCard } from "../../replicas/transcript/PatchCard";
import { Thread } from "../../replicas/transcript/Thread";
import { ToolRow } from "../../replicas/transcript/ToolRow";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { signature } from "../../sample/sessions";
import { BUILD_FILES, KICKOFF, TASK_ID } from "../../sample/studio";
import { HELP_SEARCH, QUEUE_SESSION, QUEUED, SENT, TESTS } from "./sample";
import "./view.css";

/** The turn of the Builder until the search tests run. */
function BuildRows(): ReactElement {
  return (
    <>
      <UserMessage time={SENT.kickoff}>{KICKOFF.build}</UserMessage>
      <ToolRow kind="tool" name="read_task" args={TASK_ID} duration="131ms" time="09:46:32 AM" />
      <ToolRow kind="read" name="Read" args="AGENTS.md" duration="6ms" time="09:46:35 AM" />
      {BUILD_FILES.map((file) => (
        <PatchCard
          key={file.path}
          path={file.path}
          kind={file.type === "added" ? "A" : "M"}
          add={file.add}
          del={file.del}
        />
      ))}
      <ToolRow
        kind="bash"
        name="Bash"
        args={TESTS.search.args}
        duration={TESTS.search.duration}
        time={TESTS.search.time}
        row="search-tests"
        running
      />
    </>
  );
}

/** The rows after Steer now: the steered message, the rest of the turn, and the next turn. */
function LaterRows(): ReactElement {
  return (
    <>
      <div hidden data-row="steer">
        <UserMessage time={SENT.steer}>{QUEUED.steer.text}</UserMessage>
      </div>
      <div hidden data-row="ack">
        <AgentText>
          <p>
            I will add <code>src/app</code> to the test run, so the <code>Cmd+Shift+K</code> binding
            stays covered.
          </p>
        </AgentText>
      </div>
      <div hidden data-row="keymap-tests">
        <ToolRow
          kind="bash"
          name="Bash"
          args={TESTS.keymap.args}
          duration={TESTS.keymap.duration}
          time={TESTS.keymap.time}
        />
      </div>
      <div hidden data-row="final">
        <AgentText signature={signature(QUEUE_SESSION)} worked="2m45s">
          <p>
            All 9 tests of <code>src/search</code> and <code>src/app</code> pass. I committed the
            change on the task branch.
          </p>
        </AgentText>
      </div>
      <div hidden data-row="next">
        <UserMessage time={SENT.next}>{QUEUED.next.text}</UserMessage>
      </div>
      <div hidden data-row="help-search">
        <ToolRow
          kind="search"
          name="Search"
          args={HELP_SEARCH.args}
          duration="64ms"
          time={HELP_SEARCH.time}
        />
      </div>
    </>
  );
}

export function QueueView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="queue"
      alt={`The Builder session of a task runs the search tests. While the agent works, the developer types two messages and presses Enter after each one. Each message goes into a queue above the composer: a stack of cards with the newest card in front. The pointer rests on the stack, which opens and shows both messages. On the card of ${QUEUED.steer.text} the developer clicks Steer now, and the message goes to the running work at once. The agent adds the keymap tests to its test run. When the turn ends, the next queued message, ${QUEUED.next.text} goes to the agent by itself, and a new turn starts.`}
    >
      <Replica className="qv-panel" data-runtime={QUEUE_SESSION.runtime}>
        <ChatColumn className="qv-column">
          <Thread>
            <BuildRows />
            <LaterRows />
          </Thread>
          <Composer
            session={QUEUE_SESSION}
            activity="working"
            steerKey={steerKey(props.keys)}
            queue={<QueueStack cards={[QUEUED.next, { ...QUEUED.steer, hover: true }]} spread />}
          >
            <ComposerDraft />
          </Composer>
        </ChatColumn>
        <Pointer />
      </Replica>
      <KeyHud />
    </SceneFrame>
  );
}
