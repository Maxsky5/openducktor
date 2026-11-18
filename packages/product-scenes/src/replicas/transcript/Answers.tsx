// The answers of a question tool under its line: QuestionToolAnswers of
// agent-chat-question-tool-answers.tsx. Each question has one line. Several questions show the
// label of each question before its answer. Until the user answers, each line shows No answer yet.
// A scene sets `data-answered` on the list when the answers come.
import { CornerDownRight } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import type { Answer } from "./model";
import { NO_ANSWER_YET_LABEL } from "./tool-runs";
import "./Answers.css";

export function Answers({
  items,
  answered = true,
}: {
  items: readonly Answer[];
  /** The user answered, so each line shows its answer. */
  answered?: boolean;
}): ReactElement {
  const showsLabels = items.length > 1;
  return (
    <ul className="st-answers" data-answers="" data-answered={flag(answered)}>
      {items.map((item) => (
        <li key={item.label}>
          <CornerDownRight className="i12" />
          {showsLabels && <span className="st-answer-label">{item.label}</span>}
          <span className="st-answer">{item.answer}</span>
          <span className="st-answer-none">{NO_ANSWER_YET_LABEL}</span>
        </li>
      ))}
    </ul>
  );
}
