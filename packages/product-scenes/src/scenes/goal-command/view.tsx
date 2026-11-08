// The chat column of a Builder session on OpenCode, where the visitor sets a goal with /goal and
// later pauses it. The slash menu lists /goal with its hints, and a pick puts the blue goal chip in
// the draft. Sources: agent-chat-composer-slash-menu.tsx, agent-chat-goal-chip.tsx, and
// agent-chat-goal-row.tsx in packages/frontend/src/components/features/agents/agent-chat. The
// markup holds the last frame, with the slash menu that the scene opens.
import { Terminal } from "lucide-react";
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { steerKey } from "../../replicas/keys";
import { Replica } from "../../replicas/Replica";
import { KeyHud } from "../../replicas/shell/KeyHud";
import { Pointer } from "../../replicas/shell/Pointer";
import { ChatColumn } from "../../replicas/studio/ChatColumn";
import { Composer, ComposerDraft } from "../../replicas/studio/Composer";
import { ComposerMenu } from "../../replicas/studio/ComposerMenu";
import { ComposerMenuRow } from "../../replicas/studio/ComposerMenuRow";
import { GoalRow } from "../../replicas/studio/GoalRow";
import { AgentText } from "../../replicas/transcript/AgentText";
import { PatchCard } from "../../replicas/transcript/PatchCard";
import { GOAL_CHIP_LABEL, ReferenceChip } from "../../replicas/transcript/ReferenceChip";
import { Thread } from "../../replicas/transcript/Thread";
import { ToolRow } from "../../replicas/transcript/ToolRow";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { signature } from "../../sample/sessions";
import {
  AGENT,
  COMMAND_SESSION,
  FIX_PATH,
  GOAL_COMMAND,
  OBJECTIVE,
  TEST_PATH,
  TIMES,
} from "./sample";
import "./view.css";

/** The end of the earlier turn, then the goal message and the goal turn. */
function GoalThread(): ReactElement {
  return (
    <Thread>
      <AgentText signature={signature(COMMAND_SESSION)} worked="38s" row="earlier">
        <p>
          I found the cause: <code>moveNote</code> copies the body of a note, but not its tags. The
          fix changes <code>{FIX_PATH}</code> and its test.
        </p>
      </AgentText>
      <UserMessage time={TIMES.goal} row="goal">
        <ReferenceChip kind="goal" label={GOAL_CHIP_LABEL} />
        {OBJECTIVE}
      </UserMessage>
      <ToolRow
        kind="read"
        name="Read"
        args={FIX_PATH}
        duration="9ms"
        time={TIMES.read}
        row="read"
      />
      <PatchCard path={FIX_PATH} kind="M" add={4} del={1} row="fix" />
      <PatchCard path={TEST_PATH} kind="M" add={18} row="test" />
      <ToolRow
        kind="bash"
        name="Bash"
        args="bun test src/notes"
        duration="2.1s"
        time={TIMES.run}
        row="run"
      />
      <AgentText signature={signature(COMMAND_SESSION)} worked="44s" row="final">
        <p>
          A note keeps its tags when it moves to another notebook. <code>bun test src/notes</code>:
          12 tests pass.
        </p>
      </AgentText>
    </Thread>
  );
}

export function GoalCommandView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="goal-command"
      alt={`The chat of a Builder session on OpenCode. The visitor types /go in the composer. The slash menu shows /goal, a system command, with the hints objective, pause, resume, or clear, and the text Keep working until the objective is met. The visitor presses Enter, and a blue Goal chip takes the place of the command. The visitor types the objective ${OBJECTIVE} and presses Enter. The message shows in the chat with the Goal chip. A goal row rises above the composer: Goal, Active, and the objective, with Pause goal and Clear goal. The agent reads the file, changes the code and its test, and runs the tests. While the agent works, the visitor sends /goal pause in the same way. The goal row shows Paused in amber, with Resume goal and Clear goal. The agent ends its turn and does not start another one.`}
    >
      <Replica className="gcm-panel" data-runtime={COMMAND_SESSION.runtime}>
        <ChatColumn className="gcm-column">
          <GoalThread />
          <Composer
            session={COMMAND_SESSION}
            agent={AGENT}
            steerKey={steerKey(props.keys)}
            menu={
              <ComposerMenu label="Slash commands" name="slash" count={1}>
                <ComposerMenuRow
                  name={`/${GOAL_COMMAND.trigger}`}
                  icon={<Terminal />}
                  badge={GOAL_COMMAND.source}
                  hint={GOAL_COMMAND.hint}
                  description={GOAL_COMMAND.description}
                  active
                  match={GOAL_COMMAND.trigger}
                />
              </ComposerMenu>
            }
            goal={<GoalRow objective={OBJECTIVE} status="paused" pausable />}
          >
            <ComposerDraft>
              <ReferenceChip kind="goal" label={GOAL_CHIP_LABEL} hidden data-chip="" />
            </ComposerDraft>
          </Composer>
        </ChatColumn>
        <Pointer />
      </Replica>
      <KeyHud />
    </SceneFrame>
  );
}
