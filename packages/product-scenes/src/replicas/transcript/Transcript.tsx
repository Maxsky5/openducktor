// The transcript of one or more sessions. One session shows. The others wait hidden for the scene
// that switches the session of the window. Each turn wraps its rows, so a row id is unique in its
// turn. The wrappers take no box, so the rows lay out as one list.
import type { ReactElement } from "react";
import { AgentText } from "./AgentText";
import { Answers } from "./Answers";
import type { Row, SessionData } from "./model";
import { PatchCard } from "./PatchCard";
import { ToolRow } from "./ToolRow";
import { UserMessage } from "./UserMessage";
import { WorkflowCard } from "./WorkflowCard";
import "./Transcript.css";

type TranscriptProps = {
  /** The sessions in the window, with the turns of each one that the transcript holds. */
  sessions: readonly SessionData[];
  shown: string;
};

/** A paragraph with its inline code spans, which the text marks with backticks. */
function Paragraph({ text }: { text: string }): ReactElement {
  return (
    <p>
      {text.split("`").map((part, index) =>
        // The parts of a split never change order, so the index is a stable key.
        index % 2 === 1 ? <code key={index}>{part}</code> : part,
      )}
    </p>
  );
}

function TranscriptRow({ row }: { row: Row }): ReactElement {
  switch (row.kind) {
    case "user":
      return (
        <UserMessage time={row.time} row={row.id}>
          {row.text}
        </UserMessage>
      );
    case "tool":
      return (
        <ToolRow
          kind={row.tool}
          name={row.name}
          args={row.args}
          duration={row.duration}
          time={row.time}
          row={row.id}
        >
          {row.answers && <Answers items={row.answers} />}
        </ToolRow>
      );
    case "workflow":
      return <WorkflowCard name={row.name} duration={row.duration} time={row.time} row={row.id} />;
    case "patch":
      return (
        <PatchCard path={row.path} kind={row.change} add={row.add} del={row.del} row={row.id} />
      );
    case "agent":
      return (
        <AgentText signature={row.signature} worked={row.worked} row={row.id}>
          {row.paragraphs.map((paragraph) => (
            <Paragraph key={paragraph} text={paragraph} />
          ))}
        </AgentText>
      );
  }
}

export function Transcript({ sessions, shown }: TranscriptProps): ReactElement {
  return (
    <>
      {sessions.map((session) => (
        <div
          key={session.id}
          className="st-session"
          data-session={session.id}
          hidden={session.id !== shown}
        >
          {session.turns.map((turn) => (
            <div key={turn.id} className="st-turn" data-turn={turn.id}>
              {turn.rows.map((row) => (
                <TranscriptRow key={row.id} row={row} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
