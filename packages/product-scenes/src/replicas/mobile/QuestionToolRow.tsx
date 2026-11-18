// The row of a question tool call in the mobile transcript, as tool-call-row.tsx in
// apps/mobile/src/features/session/transcript/rows. A question shows alone, outside the tool runs.
// Its line is ToolLine of row-parts.tsx: the icon of the tool, the name Question, the question as
// the summary, and the timing. While the question waits, three moving bars take the place of the
// icon, and the line shows no run time. Under the line, QuestionAnswers of tool-details.tsx shows
// the answer, or No answer yet until the user answers. A scene removes `data-running` and sets
// `data-answered` when the answer comes, with pending-question.ts.
import { CircleHelp, CornerDownRight } from "lucide-react";
import type { ReactElement } from "react";
import { RunningBars } from "./ToolRun";
import "./QuestionToolRow.css";

/** readToolCallName of agent-chat-tool-presentation.ts names each question tool Question. */
export const QUESTION_TOOL_NAME = "Question";

/** NO_ANSWER_YET_LABEL of agent-chat-tool-presentation.ts. */
export const NO_ANSWER_YET = "No answer yet";

/** The icons of the row: the question tool, as toolIcon gives it, and the mark of an answer. */
export const QUESTION_ROW_ICONS = {
  "circle-help": CircleHelp,
  "corner-down-right": CornerDownRight,
} as const;

type QuestionToolRowProps = {
  /** The prompt of the question, which the line shows as its summary. */
  prompt: string;
  /** The answer that the user gives. */
  answer: string;
  /** The time from the question to the answer, such as 52s. */
  duration: string;
  /** The clock time of the call, such as 9:50:16 AM. */
  time: string;
  /** The question waits for its answer. */
  waiting?: boolean;
  row?: string;
};

export function QuestionToolRow({
  prompt,
  answer,
  duration,
  time,
  waiting = false,
  row,
}: QuestionToolRowProps): ReactElement {
  return (
    <div
      className="mob-tool"
      data-row={row}
      data-question-row=""
      data-running={waiting ? "" : undefined}
      data-answered={waiting ? undefined : ""}
    >
      <div className="mob-tool-line">
        <span className="mob-tool-icon">
          <CircleHelp className="mob-tool-glyph" data-tool-glyph />
          <RunningBars />
        </span>
        <span className="mob-tool-name">{QUESTION_TOOL_NAME}</span>
        <span className="mob-tool-summary">{prompt}</span>
        <span className="mob-tool-timing">
          <span className="mob-tool-duration">{duration}</span>
          <span>{time}</span>
        </span>
      </div>
      <div className="mob-answers">
        <span className="mob-answer-line">
          <CornerDownRight />
          <span className="mob-answer">{answer}</span>
          <span className="mob-answer-none">{NO_ANSWER_YET}</span>
        </span>
      </div>
    </div>
  );
}
