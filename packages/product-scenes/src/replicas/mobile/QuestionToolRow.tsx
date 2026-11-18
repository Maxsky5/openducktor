// The row of a question tool call in the mobile transcript, as tool-call-row.tsx in
// apps/mobile/src/features/session/transcript/rows. A question shows alone, outside the tool runs.
// Its line is ToolLine of row-parts.tsx: the icon of the tool, the name Question, the question as
// the summary, and the timing, with the icon and the timing of a call of ToolRun.tsx. While the
// question waits, three moving bars take the place of the icon, and the line shows no run time.
// Under the line, QuestionAnswers of tool-details.tsx shows the answer, or No answer yet until the
// user answers. The view shows the answered row. pending-question.ts sets `data-running` while the
// question waits, and sets `data-answered` when the answer comes.
import { CircleHelp, CornerDownRight } from "lucide-react";
import type { ReactElement } from "react";
import { NO_ANSWER_YET_LABEL, QUESTION_TOOL_NAME } from "../transcript/tool-runs";
import { CallIcon, CallTiming } from "./ToolRun";
import "./QuestionToolRow.css";

/** The icons of the row: the question tool, as toolIcon gives it, and the mark of an answer. */
export const QUESTION_ROW_ICONS = {
  "circle-help": CircleHelp,
  "corner-down-right": CornerDownRight,
} as const;

const { "circle-help": QuestionIcon, "corner-down-right": AnswerMark } = QUESTION_ROW_ICONS;

type QuestionToolRowProps = {
  /** The prompt of the question, which the line shows as its summary. */
  prompt: string;
  /** The answer that the user gives. */
  answer: string;
  /** The time from the question to the answer, such as 52s. */
  duration: string;
  /** The clock time of the call, such as 9:50:16 AM. */
  time: string;
  row?: string;
};

export function QuestionToolRow({
  prompt,
  answer,
  duration,
  time,
  row,
}: QuestionToolRowProps): ReactElement {
  return (
    <div className="mob-tool" data-row={row} data-question-row="" data-answered="">
      <div className="mob-tool-line">
        <CallIcon icon={QuestionIcon} />
        <span className="mob-tool-name">{QUESTION_TOOL_NAME}</span>
        <span className="mob-tool-summary">{prompt}</span>
        <CallTiming duration={duration} time={time} />
      </div>
      <div className="mob-answers">
        <span className="mob-answer-line">
          <AnswerMark />
          <span className="mob-answer">{answer}</span>
          <span className="mob-answer-none">{NO_ANSWER_YET_LABEL}</span>
        </span>
      </div>
    </div>
  );
}
