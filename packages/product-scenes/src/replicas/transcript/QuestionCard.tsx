// A pending request_user_input from agent-session-question-card.tsx. A single-choice answer
// moves to the next question, and the last answer opens the Summary tab. On the last question,
// Confirm Answers replaces Next. A single question has no tabs and no summary. The scene answers
// it.
import {
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDotDashed,
  ListChecks,
  LoaderCircle,
  MessageSquarePlus,
  Sparkles,
} from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { Button } from "../ui/Button";
import type { Question } from "./model";
import { RequestCard } from "./RequestCard";
import "./QuestionCard.css";

export function QuestionCard({ questions }: { questions: readonly Question[] }): ReactElement {
  const several = questions.length > 1;
  return (
    <RequestCard
      kind="question"
      title="Input needed"
      icon={CircleDotDashed}
      meta={<small data-answered-count="">0/{questions.length} answered</small>}
    >
      <div className="st-q-tabs" hidden={!several}>
        {questions.map((question, index) => (
          <span
            key={question.header}
            className="st-q-tab"
            data-active={flag(index === 0)}
            data-q-tab={index}
          >
            <Circle className="i14 open" />
            <CircleCheck className="i14 check" />
            {question.header}
          </span>
        ))}
        <span className="st-q-tab" data-q-tab="summary">
          <ListChecks className="i14" />
          Summary
        </span>
      </div>
      {questions.map((question, index) => (
        <div key={question.header} className="st-q-page" hidden={index > 0} data-q-page={index}>
          <p>
            <span className="st-q-label">{question.header}</span>{" "}
            <span className="st-q-text">{question.question}</span>
          </p>
          <div className="st-q-options">
            {question.options.map((option) => (
              <span key={option.label} className="st-option" data-option={option.label}>
                <Circle className="i14 unpicked" />
                <CircleCheck className="i14 picked" />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </span>
            ))}
          </div>
          <span className="st-q-tab other">
            <MessageSquarePlus className="i14" />
            Other answer
          </span>
        </div>
      ))}
      <div className="st-q-summary" hidden data-q-page="summary">
        {questions.map((question) => (
          <div key={question.header}>
            <p>
              <CircleCheck className="i12" />
              {question.header}
            </p>
            <p>{question.answer}</p>
          </div>
        ))}
      </div>
      <div className="st-q-foot">
        <p data-q-status="">Answer all questions to confirm.</p>
        <span>
          <Button variant="outline" size="sm" data-q-reset>
            Reset
          </Button>
          <Button size="sm" hidden={!several} data-q-next>
            Next
            <ChevronRight className="i14" />
          </Button>
          <Button size="sm" className="st-q-confirm" data-disabled hidden={several} data-q-confirm>
            <span className="when-idle">
              <Sparkles className="i14" />
              Confirm Answers
            </span>
            <span className="when-submitting">
              <LoaderCircle className="i14 spin" />
              Submitting…
            </span>
          </Button>
        </span>
      </div>
    </RequestCard>
  );
}
