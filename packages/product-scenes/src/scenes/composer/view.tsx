// The composer of a task session, with the end of the transcript above it. The slash, reference,
// and skill menus open above the draft, and each pick becomes a chip. Sources:
// packages/frontend/src/components/features/agents/agent-chat (agent-chat-composer-editor.tsx and
// the agent-chat-composer-*-menu.tsx files). The markup holds the last frame.
import { FileCodeCorner, FileText, ScrollText, Terminal } from "lucide-react";
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { steerKey } from "../../replicas/keys";
import { AppWindow } from "../../replicas/shell/AppWindow";
import { Pointer } from "../../replicas/shell/Pointer";
import { ChatColumn } from "../../replicas/studio/ChatColumn";
import { Composer, ComposerDraft } from "../../replicas/studio/Composer";
import { ComposerMenu } from "../../replicas/studio/ComposerMenu";
import { ComposerMenuRow } from "../../replicas/studio/ComposerMenuRow";
import { AgentText } from "../../replicas/transcript/AgentText";
import { ReferenceChip } from "../../replicas/transcript/ReferenceChip";
import { Thread } from "../../replicas/transcript/Thread";
import { ToolRow } from "../../replicas/transcript/ToolRow";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { signature } from "../../sample/sessions";
import {
  COMMAND,
  COMPOSER_SESSION,
  FILE,
  FILES,
  MESSAGE,
  SKILL,
  SKILLS,
  SLASH_COMMANDS,
} from "./sample";
import "./view.css";

/** The slash, reference, and skill menus. The first row of each menu is active. */
function Menus(): ReactElement {
  return (
    <>
      <ComposerMenu label="Slash commands" name="slash" count={SLASH_COMMANDS.length}>
        {SLASH_COMMANDS.map((command, index) => (
          <ComposerMenuRow
            key={command.trigger}
            name={`/${command.trigger}`}
            icon={<Terminal />}
            badge={command.source}
            hint={command.hint}
            description={command.description}
            active={index === 0}
            match={command.trigger}
          />
        ))}
      </ComposerMenu>
      <ComposerMenu label="References" name="file" count={FILES.length}>
        {FILES.map((result, index) => (
          <ComposerMenuRow
            key={result.path}
            name={result.name}
            icon={result.kind === "code" ? <FileCodeCorner /> : <FileText />}
            detail={result.path}
            active={index === 0}
          />
        ))}
      </ComposerMenu>
      <ComposerMenu label="Skills" name="skill" count={SKILLS.length}>
        {SKILLS.map((skill, index) => (
          <ComposerMenuRow
            key={skill.name}
            name={`$${skill.name}`}
            icon={<ScrollText />}
            detail={skill.name}
            description={skill.description}
            tone="skill"
            active={index === 0}
          />
        ))}
      </ComposerMenu>
    </>
  );
}

/**
 * The draft: a typed part before each chip, and the typed text of ComposerDraft after the last
 * one. The chips hide until the visitor picks them.
 */
function Draft(): ReactElement {
  return (
    <ComposerDraft>
      <span className="typed" data-piece="slash-query" />
      <ReferenceChip kind="slash" label={`/${COMMAND}`} hidden data-piece="slash" />
      <span className="typed" data-piece="after-command" />
      <span className="typed" data-piece="file-query" />
      <ReferenceChip kind="file" label={FILE.name} fileKind={FILE.kind} hidden data-piece="file" />
      <span className="typed" data-piece="after-file" />
      <span className="typed" data-piece="skill-query" />
      <ReferenceChip kind="skill" label={SKILL} hidden data-piece="skill" />
    </ComposerDraft>
  );
}

/** The end of the earlier turn, and the turn of the sent message. */
function ComposerThread(): ReactElement {
  return (
    <Thread>
      <AgentText signature={signature(COMPOSER_SESSION)} worked="2m 14s" row="earlier">
        <p>
          The PDF export now starts each notebook section on a new page.{" "}
          <code>bun test src/export</code>: 9 tests pass.
        </p>
      </AgentText>
      {/* The sent message shows the command as text, and the file and the skill as chips. */}
      <UserMessage time="10:42:08 AM" row="message">
        {`/${COMMAND} ${MESSAGE.afterCommand}`}
        <ReferenceChip kind="file" label={FILE.name} fileKind={FILE.kind} />
        {` ${MESSAGE.afterFile}`}
        <ReferenceChip kind="skill" label={SKILL} />
      </UserMessage>
      <ToolRow
        kind="read"
        name="Read"
        args={FILE.path}
        duration="14ms"
        time="10:42:10 AM"
        row="read"
      />
      <AgentText signature={signature(COMPOSER_SESSION)} worked="6s" row="answer">
        <p>
          One page break cuts a table: its header stays on page 2, and its rows go to page 3. I will
          keep each table header with its first row.
        </p>
      </AgentText>
    </Thread>
  );
}

export function ComposerView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="composer"
      alt={`The composer of a Builder session on Claude Code. The visitor types /rev, and the slash menu lists the Claude Code commands and a reusable prompt of the workspace that match. The visitor picks /${COMMAND}, and it becomes a yellow chip. Then the visitor types @pdf and picks the file ${FILE.name} from the references, and types $ and picks the skill ${SKILL}. Each pick becomes a chip. The visitor sends the message. The transcript shows /${COMMAND} with the file and skill chips, and the agent reads the file and answers.`}
    >
      <AppWindow
        chrome={{ sidebar: "none" }}
        keys={props.keys}
        className="composer-window"
        data-runtime={COMPOSER_SESSION.runtime}
        overlay={<Pointer />}
      >
        <ChatColumn className="cv-column">
          <ComposerThread />
          <Composer session={COMPOSER_SESSION} steerKey={steerKey(props.keys)} menu={<Menus />}>
            <Draft />
          </Composer>
        </ChatColumn>
      </AppWindow>
    </SceneFrame>
  );
}
