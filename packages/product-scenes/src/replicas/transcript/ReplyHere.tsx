// The Reply here block of session-preview-content.tsx, which the session preview of the sidebar
// and the reply view of the command palette show: the question of a waiting session in the card
// of the chat. After the answer, a note replaces the card.
import { MessagesSquare } from "lucide-react";
import type { ReactElement } from "react";
import type { Question } from "./model";
import { QuestionCard } from "./QuestionCard";
import "./ReplyHere.css";

export function ReplyHere({ question }: { question: Question }): ReactElement {
  return (
    <div className="reply-here" data-reply="">
      <p className="reply-head">
        <MessagesSquare className="i14" />
        Reply here
      </p>
      <div data-reply-question="">
        <QuestionCard questions={[question]} />
      </div>
      <p className="reply-sent" hidden data-reply-sent="">
        Answer sent.
      </p>
    </div>
  );
}
