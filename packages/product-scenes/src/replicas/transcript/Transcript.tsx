// The transcript of one or more sessions. One session shows. The others wait hidden for the scene
// that switches the session of the window. Each turn wraps its rows, so a row id is unique in its
// turn. The wrappers take no box, so the rows lay out as one list. Consecutive calls of a turn
// show as one tool run, which folds when another row of the session follows it, as the
// transcript of the app groups and folds them with its default chat settings.
import type { ReactElement } from "react";
import { AgentText } from "./AgentText";
import { Answers } from "./Answers";
import type { CallData, Row, SessionData } from "./model";
import { QUESTION_TOOL_NAME, ToolRow } from "./ToolRow";
import { ToolRun } from "./ToolRun";
import { UserMessage } from "./UserMessage";
import { WorkflowCard } from "./WorkflowCard";
import { Paragraph } from "../ui/InlineCode";
import "./Transcript.css";

type TranscriptProps = {
  /** The sessions in the window, with the turns of each one that the transcript holds. */
  sessions: readonly SessionData[];
  shown: string;
};

/** A part of a turn: a row alone, or the consecutive calls of a tool run. */
type Item =
  | { kind: "row"; row: Exclude<Row, { kind: "call" }> }
  | { kind: "run"; calls: CallData[] };

function itemsOf(rows: readonly Row[]): Item[] {
  const items: Item[] = [];
  for (const row of rows) {
    const last = items.at(-1);
    if (row.kind !== "call") items.push({ kind: "row", row });
    else if (last?.kind === "run") last.calls.push(row);
    else items.push({ kind: "run", calls: [row] });
  }
  return items;
}

function TranscriptRow({ row }: { row: Exclude<Row, { kind: "call" }> }): ReactElement {
  switch (row.kind) {
    case "user":
      return (
        <UserMessage time={row.time} row={row.id}>
          {row.text}
        </UserMessage>
      );
    case "question":
      return (
        <ToolRow
          tool="question"
          name={QUESTION_TOOL_NAME}
          summary={row.summary}
          duration={row.duration}
          time={row.time}
          row={row.id}
        >
          <Answers items={row.answers} />
        </ToolRow>
      );
    case "workflow":
      return (
        <WorkflowCard
          title={row.title}
          icon={row.icon}
          pr={row.pr}
          duration={row.duration}
          time={row.time}
          row={row.id}
        />
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

/** The turns of a session. A run folds when another row of the session follows it. */
function SessionTurns({ session }: { session: SessionData }): ReactElement {
  const turns = session.turns.map((turn) => ({ id: turn.id, items: itemsOf(turn.rows) }));
  const last = turns.findLast((turn) => turn.items.length > 0);
  return (
    <>
      {turns.map((turn) => (
        <div key={turn.id} className="st-turn" data-turn={turn.id}>
          {turn.items.map((item, index) =>
            item.kind === "row" ? (
              <TranscriptRow key={item.row.id} row={item.row} />
            ) : (
              <ToolRun
                key={item.calls[0]?.id}
                calls={item.calls}
                folded={turn !== last || index < turn.items.length - 1}
              />
            ),
          )}
        </div>
      ))}
    </>
  );
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
          <SessionTurns session={session} />
        </div>
      ))}
    </>
  );
}
