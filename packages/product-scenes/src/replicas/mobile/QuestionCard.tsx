// A Structured Question of a mobile session with one question, as structured-question-card.tsx in
// apps/mobile/src/features/session/pending-input: the request card with the answered count, the
// question after its eyebrow, the options as radio rows, the Other answer switch, and the footer
// with the hint, Reset, and Confirm Answers. A single question has no tabs and no summary, and
// Confirm Answers submits at once. `data-request-state` of the card holds the state of the draft:
// `open` until the user chooses an option, `complete`, and `submitting` while the host takes the
// answer. While the answer submits, the inputs dim, Confirm Answers shows its loader, and the
// status line shows under the body. pending-question.ts moves the card. The labels come from
// pending-input-labels.ts, agent-session-question-draft.ts, and question-flow.ts.
import {
  Circle,
  CircleCheck,
  LoaderCircle,
  MessageSquarePlus,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";
import type { Question } from "../transcript/model";
import { ReplyButton, RequestCard, REQUEST_LABELS } from "./RequestCard";
import "./QuestionCard.css";

/** The words of the card that the app writes in its markup or builds from its draft. */
export const QUESTION_TEXT = {
  hint: { open: "Answer all questions to confirm.", complete: "All questions answered." },
  reset: "Reset",
  submit: "Confirm Answers",
  submitting: "Submitting…",
  other: "Other answer",
} as const;

/**
 * The icons of the card, by the app icon names: the radio mark of an option, as optionIcon of
 * question-option-icon.ts gives it, the Other answer switch, and the icon of Confirm Answers.
 */
export const QUESTION_ICONS = {
  circle: Circle,
  "circle-check": CircleCheck,
  "message-square-plus": MessageSquarePlus,
  sparkles: Sparkles,
  "loader-circle": LoaderCircle,
} satisfies Record<string, LucideIcon>;

/** The state of the draft: no answer yet, an answer, or an answer that the host takes. */
export type QuestionState = "open" | "complete" | "submitting";

/** The answered count of the header, as questionAnsweredStatus formats it. */
export function answeredStatus(answered: number, questions: number): string {
  return `${answered}/${questions} answered`;
}

/** One option: the radio mark, the label, and the description under it. */
function OptionRow({
  label,
  description,
  selected,
}: {
  label: string;
  description: string;
  selected: boolean;
}): ReactElement {
  return (
    <span
      className="mob-qoption"
      data-option={label}
      data-selected={selected ? "" : undefined}
      data-feedback="scale"
    >
      <span className="mob-qoption-content">
        <span className="mob-qoption-mark">
          <Circle data-mark="off" />
          <CircleCheck data-mark="on" />
        </span>
        <span className="mob-qoption-text">
          <span className="mob-qoption-label">{label}</span>
          <span className="mob-qoption-description">{description}</span>
        </span>
      </span>
    </span>
  );
}

type QuestionCardProps = {
  question: Question;
  state: QuestionState;
  /** The label of the chosen option. */
  chosen?: string | undefined;
  hidden?: boolean | undefined;
};

export function QuestionCard({ question, state, chosen, hidden }: QuestionCardProps): ReactElement {
  return (
    <RequestCard
      kind="question"
      description={question.header}
      status={
        <>
          <span data-when="open">{answeredStatus(0, 1)}</span>
          <span data-when="complete">{answeredStatus(1, 1)}</span>
        </>
      }
      request="question"
      state={state}
      feedback={<p>{REQUEST_LABELS.submittingAnswers}</p>}
      hidden={hidden}
    >
      <div className="mob-question">
        <p className="mob-question-prompt">
          <span className="mob-question-eyebrow">{`${question.header}  `}</span>
          {question.question}
        </p>
        <div className="mob-qoptions" role="radiogroup">
          {question.options.map((option) => (
            <OptionRow
              key={option.label}
              label={option.label}
              description={option.description}
              selected={option.label === chosen}
            />
          ))}
        </div>
        <div className="mob-question-other">
          <span className="mob-qsegment" data-feedback="scale">
            <MessageSquarePlus />
            {QUESTION_TEXT.other}
          </span>
        </div>
      </div>
      <div className="mob-question-footer">
        <p className="mob-question-hint">
          <span data-when="open">{QUESTION_TEXT.hint.open}</span>
          <span data-when="complete">{QUESTION_TEXT.hint.complete}</span>
        </p>
        <div className="mob-question-actions">
          <ReplyButton label={QUESTION_TEXT.reset} variant="outline" reply="reset" />
          <span className="mob-question-main">
            <ReplyButton
              label={
                <>
                  <span className="mob-reply-content" data-when="ready">
                    <Sparkles />
                    {QUESTION_TEXT.submit}
                  </span>
                  <span className="mob-reply-content" data-when="submitting">
                    <LoaderCircle className="spin" />
                    {QUESTION_TEXT.submitting}
                  </span>
                </>
              }
              variant="default"
              reply="confirm"
            />
          </span>
        </div>
      </div>
    </RequestCard>
  );
}
